import { Prediction, OddsStructure } from "./api"

// 定義特徵權重
interface AIWeights {
  baseProbWeight: number; // 模型基礎勝率權重
  evWeight: number;       // EV 值權重
  ratioWeight: number;    // QIN/QPL 異常資金比例權重
  largeBetWeight: number; // 大戶落飛警報權重
}

interface FeatureVector {
  baseProb: number;  // [0, 1]
  ev:       number;  // [-0.5, 1]
  ratio:    number;  // [0, 1]
  largeBet: number;  // 0 | 1
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
  private learningRate: number;
  private learnCount: Record<string, number> = {};

  constructor(learningRate = 0.05) {
    this.learningRate = learningRate;
    this.weights = typeof window !== "undefined" ? this.loadWeights() : { ...DEFAULT_WEIGHTS };
  }

  private loadWeights(): Record<string, AIWeights> {
    try {
      if (typeof window === "undefined") return { ...DEFAULT_WEIGHTS };
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const merged: Record<string, AIWeights> = {};
        // 深層逐屬性合併
        for (const key of Object.keys(DEFAULT_WEIGHTS)) {
          merged[key] = {
            ...DEFAULT_WEIGHTS[key],
            ...(parsed[key] ?? {}),
          };
        }
        return merged;
      }
    } catch (e) {
      console.error("Failed to load AI weights", e);
    }
    return { ...DEFAULT_WEIGHTS };
  }

  private saveWeights() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.weights));
    } catch (e) {
      console.error("Failed to save AI weights", e);
    }
  }

  // 動態取得學習率 (隨學習次數遞減，避免震盪)
  private getEffectiveLR(raceType: string): number {
    const n = this.learnCount[raceType] ?? 0;
    return this.learningRate / (1 + n * 0.05);
  }

  // 取得特徵向量並正規化
  private getFeatures(p: Prediction): FeatureVector {
    const win = (p.estWinInvestment ?? 0);
    const qin = (p.estQINInvestment ?? 0);
    const qpl = (p.estQPLInvestment ?? 0);
    const qinWinRatio = win > 0 ? qin / win : 0;
    const qplWinRatio = win > 0 ? qpl / win : 0;
    const maxRatio = Math.max(qinWinRatio, qplWinRatio);

    return {
      baseProb: p.winProbModel || 0,
      ev: Math.max(-1, Math.min(2, p.expectedValue || 0)) / 2, // 縮放至 [-0.5, 1]
      ratio: Math.min(maxRatio, 5) / 5, // 縮放至 [0, 1]
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

    // 回退邏輯：明確檢查是否所有馬的分數都完全相同（包含全 0）
    const allScoresEqual = scoredRunners.every(r => r.score === scoredRunners[0].score);
    if (allScoresEqual) {
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

    // 使用工作副本 (Draft) 進行防禦性拷貝
    const draft = { ...this.weights[raceType] };
    const effectiveLR = this.getEffectiveLR(raceType);

    // 1. 取得所有馬的特徵與當前分數
    const runnersWithScore = validRunners.map(p => ({
      p,
      features: this.getFeatures(p),
      score: this.calculateScore(p, raceType),
      isWinner: String(p.runnerNumber) === String(winningRunnerNumber)
    }));

    // 2. 將分數轉為 softmax 機率分佈
    const maxScore = Math.max(...runnersWithScore.map(r => r.score));
    const exps = runnersWithScore.map(r => Math.exp(r.score - maxScore));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    
    // 3. 計算誤差並更新權重
    runnersWithScore.forEach((r, i) => {
      const prob = exps[i] / sumExps;
      const target = r.isWinner ? 1 : 0;
      const error = target - prob;

      draft.baseProbWeight += effectiveLR * error * r.features.baseProb;
      draft.evWeight       += effectiveLR * error * r.features.ev;
      draft.ratioWeight    += effectiveLR * error * r.features.ratio;
      draft.largeBetWeight += effectiveLR * error * r.features.largeBet;
    });

    // 限制權重範圍避免發散
    const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
    
    if (raceType === "CHAOTIC") {
      draft.evWeight = clamp(draft.evWeight, 0.1, 5.0);
    } else {
      draft.evWeight = clamp(draft.evWeight, -3.0, 0.5);
    }
    
    draft.baseProbWeight = clamp(draft.baseProbWeight, 0.1, 3.0);
    draft.ratioWeight = clamp(draft.ratioWeight, 0, 5.0);
    draft.largeBetWeight = clamp(draft.largeBetWeight, 0, 3.0);

    // 原子性寫回
    this.weights[raceType] = draft;
    this.learnCount[raceType] = (this.learnCount[raceType] ?? 0) + 1;
    this.saveWeights();
    
    if (process.env.NODE_ENV !== "production") {
      console.log(`[AI Learning] RaceType ${raceType} weights updated (LR: ${effectiveLR.toFixed(3)}):`, draft);
    }
  }

  // 取得當前權重供 UI 顯示 (回傳深拷貝防修改)
  public getCurrentWeights(): Record<string, AIWeights> {
    return JSON.parse(JSON.stringify(this.weights));
  }

  // 重置權重
  public resetWeights(raceType?: string): void {
    if (raceType) {
      this.weights[raceType] = { ...DEFAULT_WEIGHTS[raceType] };
      this.learnCount[raceType] = 0;
    } else {
      this.weights = { ...DEFAULT_WEIGHTS };
      this.learnCount = {};
    }
    this.saveWeights();
    console.info(`[AI Learning] Weights reset${raceType ? ` for ${raceType}` : " (all)"}`);
  }
}

// Lazy Singleton 實作，防止 SSR (Next.js/Netlify) 環境下崩潰
let _aiEngine: AILearningEngine | null = null;
export const aiEngine = new Proxy({} as AILearningEngine, {
  get: (target, prop: keyof AILearningEngine) => {
    if (!_aiEngine) _aiEngine = new AILearningEngine();
    return _aiEngine[prop];
  }
});
