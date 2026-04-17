import { Prediction, OddsStructure } from "./api"

// 定義特徵權重
interface AIWeights {
  baseProbWeight: number; // 模型基礎勝率權重
  evWeight: number;       // EV 值權重
  ratioWeight: number;    // QIN/QPL 異常資金比例權重
  largeBetWeight: number; // 大戶落飛警報權重
}

// 預設各賽局類型的權重
const DEFAULT_WEIGHTS: Record<string, AIWeights> = {
  BANKER: { baseProbWeight: 1.0, evWeight: -0.5, ratioWeight: 1.5, largeBetWeight: 0.5 },
  SPLIT: { baseProbWeight: 1.0, evWeight: -0.2, ratioWeight: 1.2, largeBetWeight: 0.8 },
  CHAOTIC: { baseProbWeight: 0.2, evWeight: 1.5, ratioWeight: 2.0, largeBetWeight: 1.5 },
  UNKNOWN: { baseProbWeight: 1.0, evWeight: 0, ratioWeight: 0, largeBetWeight: 0 },
};

const STORAGE_KEY = "masterjoe_ai_learning_weights";

class AILearningEngine {
  private weights: Record<string, AIWeights>;

  constructor() {
    this.weights = this.loadWeights();
  }

  private loadWeights(): Record<string, AIWeights> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // 簡單合併預設值，避免缺少屬性
        return { ...DEFAULT_WEIGHTS, ...parsed };
      }
    } catch (e) {
      console.error("Failed to load AI weights", e);
    }
    return { ...DEFAULT_WEIGHTS };
  }

  private saveWeights() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.weights));
      // 同步到後端資料庫
      Object.entries(this.weights).forEach(([raceType, weights]) => {
        fetch("/api/weights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raceType, weights, learnCount: 1 })
        }).catch(err => console.error("Failed to sync AI weights to Neon DB", err));
      });
    } catch (e) {
      console.error("Failed to save AI weights", e);
    }
  }

  // 取得特徵向量
  private getFeatures(p: Prediction) {
    const win = (p.estWinInvestment ?? 0);
    const qin = (p.estQINInvestment ?? 0);
    const qpl = (p.estQPLInvestment ?? 0);
    const qinWinRatio = win > 0 ? qin / win : 0;
    const qplWinRatio = win > 0 ? qpl / win : 0;
    const maxRatio = Math.max(qinWinRatio, qplWinRatio);

    return {
      baseProb: p.winProbModel || 0,
      ev: p.expectedValue || 0,
      ratio: maxRatio || 0,
      largeBet: p.moneyAlert === "large_bet" ? 1 : 0,
    };
  }

  // 評估單匹馬的 AI 綜合分數
  public calculateScore(p: Prediction, raceType: string): number {
    const w = this.weights[raceType] || this.weights.UNKNOWN;
    const f = this.getFeatures(p);

    // Score = W1*baseProb + W2*ev + W3*ratio + W4*largeBet
    return (
      w.baseProbWeight * f.baseProb +
      w.evWeight * f.ev +
      w.ratioWeight * f.ratio +
      w.largeBetWeight * f.largeBet
    );
  }

  // 取得系統首選
  public getTopPick(predictions: Prediction[], oddsStructure?: OddsStructure): string | number | undefined {
    const validRunners = predictions.filter(p => !String(p.runnerNumber).startsWith("R"));
    if (validRunners.length === 0) return undefined;

    const raceType = oddsStructure?.raceTypeCode || "UNKNOWN";

    // 針對所有馬匹計算分數
    const scoredRunners = validRunners.map(p => ({
      runnerNumber: p.runnerNumber,
      score: this.calculateScore(p, raceType),
      modelOdds: p.modelOdds
    }));

    // 依照 AI 綜合分數排序 (由高到低)
    scoredRunners.sort((a, b) => b.score - a.score);

    // 如果所有馬的分數都差不多（例如權重為 0），退回原版最低 modelOdds 邏輯
    if (scoredRunners[0].score === 0 && scoredRunners[scoredRunners.length - 1].score === 0) {
      return [...validRunners].sort((a, b) => a.modelOdds - b.modelOdds)[0]?.runnerNumber;
    }

    return scoredRunners[0].runnerNumber;
  }

  // 賽後回饋：自動學習調整權重 (Gradient Descent-like)
  public feedbackResult(predictions: Prediction[], oddsStructure: OddsStructure | undefined, winningRunnerNumber: string | number) {
    const raceType = oddsStructure?.raceTypeCode || "UNKNOWN";
    if (raceType === "UNKNOWN") return; // 未知賽局不學習

    const validRunners = predictions.filter(p => !String(p.runnerNumber).startsWith("R"));
    const winner = validRunners.find(p => String(p.runnerNumber) === String(winningRunnerNumber));
    if (!winner) return;

    const currentWeights = this.weights[raceType];
    const learningRate = 0.05; // 學習率

    // 1. 取得所有馬的特徵與當前分數
    const runnersWithScore = validRunners.map(p => ({
      p,
      features: this.getFeatures(p),
      score: this.calculateScore(p, raceType),
      isWinner: String(p.runnerNumber) === String(winningRunnerNumber)
    }));

    // 2. 將分數轉為 softmax 機率分佈 (簡化版)
    // 為了避免數值爆炸，先找出最大分數
    const maxScore = Math.max(...runnersWithScore.map(r => r.score));
    const exps = runnersWithScore.map(r => Math.exp(r.score - maxScore));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    
    // 3. 計算誤差並更新權重
    runnersWithScore.forEach((r, i) => {
      const prob = exps[i] / sumExps;
      const target = r.isWinner ? 1 : 0;
      const error = target - prob; // 如果是贏家但機率低，error > 0 (需要增加權重)；反之 error < 0

      // 更新規則：Weight = Weight + LearningRate * Error * FeatureValue
      currentWeights.baseProbWeight += learningRate * error * r.features.baseProb;
      currentWeights.evWeight       += learningRate * error * r.features.ev;
      currentWeights.ratioWeight    += learningRate * error * r.features.ratio;
      currentWeights.largeBetWeight += learningRate * error * r.features.largeBet;
    });

    // 限制權重範圍避免發散
    const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
    
    if (raceType === "CHAOTIC") {
      // 混亂局：EV 權重必須是正的
      currentWeights.evWeight = clamp(currentWeights.evWeight, 0.1, 5.0);
    } else {
      // 馬膽/分立局：EV 權重傾向於負的或 0
      currentWeights.evWeight = clamp(currentWeights.evWeight, -3.0, 0.5);
    }
    
    currentWeights.baseProbWeight = clamp(currentWeights.baseProbWeight, 0.1, 3.0);
    currentWeights.ratioWeight = clamp(currentWeights.ratioWeight, 0, 5.0);
    currentWeights.largeBetWeight = clamp(currentWeights.largeBetWeight, 0, 3.0);

    this.weights[raceType] = currentWeights;
    this.saveWeights();
    
    console.log(`[AI Learning] RaceType ${raceType} weights updated:`, currentWeights);
  }

  // 取得當前權重供 UI 顯示
  public getCurrentWeights() {
    return this.weights;
  }
}

export const aiEngine = new AILearningEngine();
