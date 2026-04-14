// src/services/aiLearning.ts
// AI 學習引擎 — 賽局自適應權重 + Softmax 梯度學習
//
// 預設權重（未經賽後學習前）:
//   正常局 (BANKER / SPLIT)：W1=1.0, W2=-0.3~-0.6, W3=0.5, W4=1.0
//   混亂局 (CHAOTIC)        ：W1=0.5, W2=1.5,       W3=1.2, W4=0.8

import { Prediction, OddsStructure } from "./api"

// ─── Types ────────────────────────────────────────────────────────────────────
interface AIWeights {
  baseProbWeight: number   // W1 基礎勝率
  evWeight:       number   // W2 EV 值
  ratioWeight:    number   // W3 QIN/QPL 異常資金比例
  largeBetWeight: number   // W4 大戶落飛警報
}

// ─── Default weights ──────────────────────────────────────────────────────────
// 正常局 (BANKER / SPLIT / FAVORITE):
//   - W2 EV 值為負：正常局中 EV 高的馬往往是冷門，不應過份追捧
//   - W3 資金比例 0.5：連贏資金訊號存在但不主導
//   - W4 大戶落飛 1.0：大戶資金是主要確認訊號
//
// 混亂局 (CHAOTIC):
//   - W1 勝率 0.5：四熱勢均，模型基礎勝率參考價值大幅降低
//   - W2 EV 1.5：混亂局最看重市場定價偏差
//   - W3 資金比例 1.2：連贏資金流向是最關鍵訊號
//   - W4 大戶 0.8：大戶動向重要但次於資金流向

const DEFAULT_WEIGHTS: Record<string, AIWeights> = {
  // ── 正常局：W2 ∈ [-0.3, -0.6]，W3=0.5，W4=1.0 ──────────────────────────
  BANKER: {
    baseProbWeight: 1.0,   // W1 — 大熱門局完全依賴基礎勝率
    evWeight:      -0.5,   // W2 — EV 負權重 (中等)：-0.5 接近 -0.3~-0.6 中點
    ratioWeight:    0.5,   // W3 — 連贏資金輔助確認
    largeBetWeight: 1.0,   // W4 — 大戶落飛是最強確認訊號
  },
  SPLIT: {
    baseProbWeight: 1.0,   // W1
    evWeight:      -0.3,   // W2 — SPLIT 不確定性略高，負值較小
    ratioWeight:    0.5,   // W3
    largeBetWeight: 1.0,   // W4
  },
  // ── 混亂局：W1=0.5, W2=1.5, W3=1.2, W4=0.8 ─────────────────────────────
  CHAOTIC: {
    baseProbWeight: 0.5,   // W1 — 基礎勝率參考價值大幅降低（由 0.2 升至 0.5）
    evWeight:       1.5,   // W2 — 混亂局非常看重 EV
    ratioWeight:    1.2,   // W3 — 更看重連贏資金流向
    largeBetWeight: 0.8,   // W4 — 大戶訊號仍有參考但優先級降低
  },
  // ── 未知賽局：退回 modelOdds 邏輯 ────────────────────────────────────────
  UNKNOWN: {
    baseProbWeight: 1.0,
    evWeight:       0.0,
    ratioWeight:    0.0,
    largeBetWeight: 0.0,
  },
}

// ─── Clamp ranges (post-learning bounds) ─────────────────────────────────────
// 學習後的權重上下限，防止梯度下降發散
const CLAMP_RANGES: Record<string, { ev: [number, number]; base: [number, number]; ratio: [number, number]; large: [number, number] }> = {
  BANKER:  { ev: [-3.0,  0.0], base: [0.5, 3.0], ratio: [0.0, 2.0], large: [0.3, 2.0] },
  SPLIT:   { ev: [-2.0,  0.5], base: [0.5, 3.0], ratio: [0.0, 2.0], large: [0.3, 2.0] },
  CHAOTIC: { ev: [ 0.1,  5.0], base: [0.1, 2.0], ratio: [0.3, 5.0], large: [0.0, 2.0] },
  UNKNOWN: { ev: [-1.0,  1.0], base: [0.1, 2.0], ratio: [0.0, 2.0], large: [0.0, 2.0] },
}

const STORAGE_KEY  = "masterjoe_ai_weights_v2"  // bumped version → resets old weights
const LEARNING_RATE = 0.05

// ─── Engine ───────────────────────────────────────────────────────────────────
class AILearningEngine {
  private weights: Record<string, AIWeights>

  constructor() {
    this.weights = this.loadWeights()
  }

  // ── Persistence ─────────────────────────────────────────────────────────────
  private loadWeights(): Record<string, AIWeights> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, AIWeights>
        // Deep merge: keep DEFAULT structure, overwrite only known keys
        const merged: Record<string, AIWeights> = { ...DEFAULT_WEIGHTS }
        for (const key of Object.keys(DEFAULT_WEIGHTS)) {
          if (parsed[key]) {
            merged[key] = { ...DEFAULT_WEIGHTS[key], ...parsed[key] }
          }
        }
        return merged
      }
    } catch (e) {
      console.error("[AI] Failed to load weights:", e)
    }
    return { ...DEFAULT_WEIGHTS }
  }

  private saveWeights(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.weights))
    } catch (e) {
      console.error("[AI] Failed to save weights:", e)
    }
  }

  // ── Feature extraction ───────────────────────────────────────────────────────
  private getFeatures(p: Prediction) {
    const win = p.estWinInvestment ?? 0
    const qin = p.estQINInvestment ?? 0
    const qpl = p.estQPLInvestment ?? 0
    const qinRatio = win > 0 ? qin / win : 0
    const qplRatio = win > 0 ? qpl / win : 0

    return {
      baseProb: p.winProbModel  || 0,
      ev:       p.expectedValue || 0,
      ratio:    Math.max(qinRatio, qplRatio),
      // FIX: moneyAlert value is "largebet" (no underscore), not "large_bet"
      largeBet: p.moneyAlert === "largebet" ? 1 : 0,
    }
  }

  // ── Score calculation ────────────────────────────────────────────────────────
  // Score = W1·baseProb + W2·ev + W3·ratio + W4·largeBet
  public calculateScore(p: Prediction, raceType: string): number {
    const w = this.weights[raceType] ?? this.weights.UNKNOWN
    const f = this.getFeatures(p)
    return (
      w.baseProbWeight * f.baseProb +
      w.evWeight       * f.ev       +
      w.ratioWeight    * f.ratio    +
      w.largeBetWeight * f.largeBet
    )
  }

  // ── Top pick selection ───────────────────────────────────────────────────────
  public getTopPick(
    predictions: Prediction[],
    oddsStructure?: OddsStructure,
  ): string | number | undefined {
    const valid = predictions.filter(p => !String(p.runnerNumber).startsWith("R"))
    if (valid.length === 0) return undefined

    const raceType = oddsStructure?.raceTypeCode || "UNKNOWN"
    const scored   = valid.map(p => ({
      runnerNumber: p.runnerNumber,
      score:        this.calculateScore(p, raceType),
      modelOdds:    p.modelOdds,
    }))

    scored.sort((a, b) => b.score - a.score)

    // Fallback: all zero → use lowest modelOdds
    if (scored[0].score === 0 && scored[scored.length - 1].score === 0) {
      return [...valid].sort((a, b) => a.modelOdds - b.modelOdds)[0]?.runnerNumber
    }

    return scored[0].runnerNumber
  }

  // ── Post-race learning (Softmax gradient descent) ────────────────────────────
  public feedbackResult(
    predictions:          Prediction[],
    oddsStructure:        OddsStructure | undefined,
    winningRunnerNumber:  string | number,
  ): void {
    const raceType = oddsStructure?.raceTypeCode || "UNKNOWN"
    if (raceType === "UNKNOWN") return

    const valid  = predictions.filter(p => !String(p.runnerNumber).startsWith("R"))
    const winner = valid.find(p => String(p.runnerNumber) === String(winningRunnerNumber))
    if (!winner) return

    const w = this.weights[raceType]

    // Softmax probabilities
    const runnersData = valid.map(p => ({
      features: this.getFeatures(p),
      score:    this.calculateScore(p, raceType),
      isWinner: String(p.runnerNumber) === String(winningRunnerNumber),
    }))
    const maxScore = Math.max(...runnersData.map(r => r.score))
    const exps     = runnersData.map(r => Math.exp(r.score - maxScore))
    const sumExps  = exps.reduce((a, b) => a + b, 0)

    // Gradient update: W += lr * (target - prob) * feature
    runnersData.forEach((r, i) => {
      const prob  = exps[i] / sumExps
      const error = (r.isWinner ? 1 : 0) - prob
      w.baseProbWeight += LEARNING_RATE * error * r.features.baseProb
      w.evWeight       += LEARNING_RATE * error * r.features.ev
      w.ratioWeight    += LEARNING_RATE * error * r.features.ratio
      w.largeBetWeight += LEARNING_RATE * error * r.features.largeBet
    })

    // Clamp post-update
    const clamp  = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    const ranges = CLAMP_RANGES[raceType] ?? CLAMP_RANGES.UNKNOWN
    w.evWeight       = clamp(w.evWeight,       ranges.ev[0],    ranges.ev[1])
    w.baseProbWeight = clamp(w.baseProbWeight,  ranges.base[0],  ranges.base[1])
    w.ratioWeight    = clamp(w.ratioWeight,     ranges.ratio[0], ranges.ratio[1])
    w.largeBetWeight = clamp(w.largeBetWeight,  ranges.large[0], ranges.large[1])

    this.weights[raceType] = w
    this.saveWeights()
    console.log(`[AI Learning] ${raceType} weights updated:`, { ...w })
  }

  // ── Accessors ────────────────────────────────────────────────────────────────
  public getCurrentWeights(): Record<string, AIWeights> {
    return this.weights
  }

  public getDefaultWeights(): Record<string, AIWeights> {
    return { ...DEFAULT_WEIGHTS }
  }

  // Reset a specific raceType back to defaults (useful for manual override)
  public resetWeights(raceType?: string): void {
    if (raceType) {
      if (DEFAULT_WEIGHTS[raceType]) {
        this.weights[raceType] = { ...DEFAULT_WEIGHTS[raceType] }
        this.saveWeights()
        console.log(`[AI] Reset ${raceType} to defaults`)
      }
    } else {
      this.weights = { ...DEFAULT_WEIGHTS }
      this.saveWeights()
      console.log("[AI] All weights reset to defaults")
    }
  }
}

export const aiEngine = new AILearningEngine()
