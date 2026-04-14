export interface Meeting {
  id: string; venue: string; venueCode: string;
  date: string; status: string; totalRaces: number;
}
export interface Race {
  id: string; raceNumber: number; raceName: string;
  distance: number; course: string; raceClass: string;
  runners: number; meetingId: string; venueCode: string;
}
export interface Prediction {
  runnerNumber: number; runnerName: string; jockey: string; trainer: string;
  draw: number; weight: number; winProbability: number; placeProb: number;
  winOdds: number | string; placeOdds: number | string;
  score: number; grade: "A" | "B" | "C" | "D";
  rating: number; horseWeight: number; last3Form: string; analysis: string;
  weightD: number; weightRatio: number; weightRD: number; weightRDBenchmark?: number;
  isGoldenWeightRD?: boolean; goldenScore?: number;
  isStrongStar?: boolean; isBlueStar?: boolean;
  timeAdvantage: number; statRate: number; statScore: number;
  ratingScore: number; ageBonus: number; age: number;
  ageStage: "risingstar" | "primewarrior" | "veteran";
  ageStageLabel: "潛力新星" | "巔峰戰將" | "沙場老將";
  conditionLabel: string; conditionMultiplier: number;
  investmentLabel?: "BEST" | "STABLE" | "DARKHORSE" | "RISK" | "NONE";
  riskFactors?: string[];
  winProbModel: number; marketImpliedProb: number;
  modelOdds: number; diffProb: number;
  expectedValue: number; kellyFraction: number;
  combatAdvice?: string;
  combatStatus?: "GO" | "SHADOW" | "CAUTION" | "AVOID";
  oddsHistory?: {
    overnight: number | string | null; min30: number | string | null;
    min15: number | string | null; prev3min?: number | string | null; current: number | string | null;
  };
  // ── NEW: 彩池投注額估算 ──
  estWinInvestment?: number;
  estQINInvestment?: number;
  estQPLInvestment?: number;
  moneyAlert?: "large_bet" | "drifting" | "qin_overflow" | "shortening" | "steady";
  finalPosition?: number | null | string; // 賽果名次
  isTheoretical?: boolean;
}

export interface OddsStructure {
  raceType:     "馬膽局" | "分立局" | "混亂局" | "未能判斷"
  raceTypeCode: "BANKER" | "SPLIT" | "CHAOTIC" | "UNKNOWN"
  od1:          number
  od2:          number
  od3:          number
  od4:          number
  od1Name?: string
  od2Name?: string
  od3Name?: string
  od4Name?: string
  od1Number?: string | number
  od2Number?: string | number
  od3Number?: string | number
  od4Number?: string | number
  od1Count?:    number
  od2Count?:    number
  od3Count?:    number
  hotCount:     number
  coldSignal:   boolean
  qinFocus:     "od1_group" | "od2_od3_group" | "spread" | "unknown"
  topBanker:    string | null
  coldCandidates: (string | number)[]
  description:  string
  tip:          string
  oddsPattern?: string
}

export interface RaceDetail extends Race {
  date: string; track: string; going: string;
  postTime: string; meetingType: string;
  topPick: Prediction; predictions: Prediction[];
  summary: string; confidence: "HIGH" | "MEDIUM" | "LOW";
  isPreRace?: boolean;
  // ── NEW: 彩池總額 ──
  pools?: { WIN?: number; PLA?: number; QIN?: number; QPL?: number; DBL?: number };
  oddsStructure?: OddsStructure;
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
      const txt = await res.text();
      try { throw new Error(JSON.parse(txt).error || `失敗: ${res.status}`); }
      catch { throw new Error(`失敗: ${res.status} ${res.statusText}`); }
    }
    return res.json();
  },
  getAlerts: async (limit = 30, severity?: string, date?: string, type?: string, venue?: string, raceNo?: number) => {
    let q = `?limit=${limit}`
    if (severity) q += `&severity=${severity}`
    if (date) q += `&date=${date}`
    if (type) q += `&type=${type}`
    if (venue) q += `&venue=${venue}`
    if (raceNo) q += `&raceNo=${raceNo}`
    const res = await fetch(`/api/alerts${q}`);
    if (!res.ok) throw new Error("獲取警告數據失敗");
    return res.json();
  },
};
