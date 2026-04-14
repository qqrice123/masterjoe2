// ══════════════════════════════════════════════════════════════════════════════
// Type Definitions for 馬靈靈 Analytics
// ══════════════════════════════════════════════════════════════════════════════

export type RaceType = "馬膽局" | "分立局" | "混亂局" | "未能判斷"
export type RaceTypeCode = "BANKER" | "SPLIT" | "CHAOTIC" | "UNKNOWN"
export type QinFocus = "od1_group" | "od2_od3_group" | "spread" | "unknown"
export type Grade = "A" | "B" | "C" | "D"
export type InvestmentLabel = "BEST" | "STABLE" | "DARKHORSE" | "RISK" | "NONE"
export type CombatStatus = "GO" | "CAUTION" | "SHADOW" | "AVOID"
export type MoneyAlert = "large_bet" | "drifting" | "qin_overflow" | "shortening" | "steady"
export type AgeStage = "risingstar" | "primewarrior" | "veteran" | "unknown"

export interface OddsHistory {
  overnight: number | null
  min30: number | null
  min15: number | null
  current: number | string
}

export interface OddsStructureResult {
  raceType: RaceType
  raceTypeCode: RaceTypeCode
  od1: number
  od2: number
  od3: number
  od4: number
  od1Name?: string
  od2Name?: string
  od3Name?: string
  od4Name?: string
  od1Count: number
  od2Count: number
  od3Count: number
  oddsPattern: string
  hotCount: number
  coldSignal: boolean
  qinFocus: QinFocus
  topBanker: string | null
  coldCandidates: (string | number)[]
  description: string
  tip: string
}

export interface RunnerPrediction {
  runnerNumber: string | number
  runnerName: string
  jockey: string
  trainer: string
  draw: number
  weight: number
  winProbability: number
  placeProb: number
  winOdds: number | string
  placeOdds: number | string
  score: number
  grade: Grade
  rating: number
  horseWeight: number
  last3Form: string
  investmentLabel: InvestmentLabel
  riskFactors: string[]
  weightD: number
  weightRatio: number
  weightRD: number
  weightRDBenchmark?: number
  isGoldenWeightRD?: boolean
  goldenScore?: number
  isStrongStar?: boolean
  isBlueStar?: boolean
  timeAdvantage: number
  statRate: number
  statScore: number
  ratingScore: number
  age: number
  ageStage: AgeStage
  ageStageLabel: string
  ageBonus: number
  conditionLabel: string
  conditionMultiplier: number
  marketImpliedProb: number
  winProbModel: number
  modelOdds: number
  diffProb: number 
  expectedValue: number
  kellyFraction: number
  analysis: string
  oddsHistory: OddsHistory
  estWinInvestment: number | null
  estQINInvestment: number | null
  estQPLInvestment: number | null
  _qinRatio?: number // 混亂局判斷異常柱體比例用
  moneyAlert?: MoneyAlert
  isTheoretical: boolean
  combatAdvice?: string
  combatStatus?: CombatStatus
  finalPosition?: number | null
}

export interface PoolData {
  WIN: number
  PLA: number
  QIN: number
  QPL: number
  DBL: number
}

export interface RaceDetail {
  id: string
  raceNumber: number
  raceName: string
  distance: number
  distanceMeters: number
  benchmarkRD: number
  course: string
  raceClass: string
  runners: number
  totalRaces: number
  meetingId: string
  venueCode: string
  date: string
  track: string
  going: string
  postTime: string
  meetingType: string
  topPick: RunnerPrediction
  predictions: RunnerPrediction[]
  pools: PoolData | null
  oddsStructure: OddsStructureResult
  isPreRace: boolean
  summary: string
  aiSummary: string
  confidence: "HIGH" | "MEDIUM" | "LOW"
}

export interface DynamicWeights {
  wStat: number
  wBurden: number
  wRating: number
  wAge: number
  wTime: number
}

export interface Meeting {
  id: string
  venue: string
  venueCode: string
  date: string
  status: string
  totalRaces: number
}

export interface Race {
  id: string
  raceNumber: number
  raceName: string
  distance: number
  course: string
  raceClass: string
  runners: number
  meetingId: string
  venueCode: string
}
