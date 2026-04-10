export interface Meeting {
  id: string;
  venue: string;
  venueCode: string;
  date: string;
  status: string;
  totalRaces: number;
}

export interface Race {
  id: string;
  raceNumber: number;
  raceName: string;
  distance: number;
  course: string;
  raceClass: string;
  runners: number;
  meetingId: string;
  venueCode: string;
}

export interface Prediction {
  runnerNumber: number;
  runnerName: string;
  jockey: string;
  trainer: string;
  draw: number;
  weight: number;
  winProbability: number;
  placeProb: number;
  winOdds: number | string;
  placeOdds: number | string;
  score: number;
  grade: "A" | "B" | "C" | "D";
  rating: number;
  horseWeight: number;
  last3Form: string;
  analysis: string;
  weightD: number;
  weightRatio: number;
  weightRD: number;
  timeAdvantage: number;
  statRate: number;
  statScore: number;
  ratingScore: number;
  ageBonus: number;
  age: number;
  ageStage: "risingstar" | "primewarrior" | "veteran";
  ageStageLabel: "潛力新星" | "巔峰戰將" | "沙場老將";
  conditionLabel: string;
  conditionMultiplier: number;
  investmentLabel?: "BEST" | "STABLE" | "DARKHORSE" | "RISK" | "NONE";
  riskFactors?: string[];
  winProbModel: number;
  marketImpliedProb: number;
  modelOdds: number;
  diffProb: number;
  expectedValue: number;
  kellyFraction: number;
  combatAdvice?: string;
  combatStatus?: "GO" | "SHADOW" | "CAUTION" | "AVOID";
  oddsHistory?: {
    overnight: number | string;
    min30: number | string;
    min15: number | string;
    current: number | string;
  };
}

export interface RaceDetail extends Race {
  date: string;
  track: string;
  going: string;
  postTime: string;
  meetingType: string;
  topPick: Prediction;
  predictions: Prediction[];
  summary: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export const api = {
  getMeetings: async (): Promise<Meeting[]> => {
    const res = await fetch("/api/meetings");
    if (!res.ok) throw new Error("獲取會議數據失敗");
    return res.json();
  },
  getRaces: async (): Promise<Race[]> => {
    const res = await fetch("/api/races");
    if (!res.ok) throw new Error("獲取賽事數據失敗");
    return res.json();
  },
  getRaceDetail: async (venueCode: string, raceNumber: number): Promise<RaceDetail> => {
    const res = await fetch(`/api/predict/${venueCode}/${raceNumber}`);
    if (!res.ok) {
      const errorText = await res.text();
      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(errorJson.error || `獲取賽事詳情失敗: ${res.status}`);
      } catch {
        throw new Error(`獲取賽事詳情失敗: ${res.status} ${res.statusText}`);
      }
    }
    return res.json();
  },
};
