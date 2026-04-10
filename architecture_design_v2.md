# 🏇 Master Joe Racing — React 系統架構與設計文件 v2.0
> **修訂版**：根據原始分析框架檔案（`newform_v2.txt`、`weight_formula.txt`、`script_1.txt`、`horse-racing-analysis-system.md`）全面修正。

---

## 目錄
1. [系統總覽](#1-系統總覽)
2. [核心分析引擎（修正版）](#2-核心分析引擎修正版)
3. [實時資金流追蹤](#3-實時資金流追蹤)
4. [期望值-ev-運算引擎](#4-期望值-ev-運算引擎)
5. [React 系統架構](#5-react-系統架構)
6. [人性化介面設計](#6-人性化介面設計)
7. [API 整合實作](#7-api-整合實作)
8. [部署與優化路線圖](#8-部署與優化路線圖)

---

## 1. 系統總覽

本系統是一個基於 **React 18 + TypeScript** 的現代化賽馬實時分析 Web App。在原有四維度框架基礎上，整合以下三大升級模組：

| 升級模組 | 功能描述 |
|---|---|
| **步速預測 + 檔位群組** | 量化賽事節奏與賽道偏差，動態調整個馬評分 |
| **HKJC GraphQL 資金流** | 實時追蹤 WIN / PLA / QIN / QPL / DBL 各彩池資金，逆向推算單馬投注額 |
| **EV 運算引擎** | 比對系統模擬勝率與即時賠率，找出正期望值（+EV）投注機會 |

---

## 2. 核心分析引擎（修正版）

> ⚠️ 此章節已根據原始檔案全面修正，包含動態基準值、自適應權重、狀態乘數等關鍵邏輯。

### 2.1 統計數據表（完整版）

原始系統同時涵蓋**正常地**與**變化地**兩套統計，缺一不可。

```typescript
// 來源：newform_v2.txt / script_1.txt
const STATISTICAL_WIN_RATES: Record<string, Record<string, number>> = {
  // 短途（≤1200m）正常地
  short_normal:   { "<119": 50.0,  "120-124": 57.8, "125-129": 25.0,  "130+": 57.1  },
  // 短途（≤1200m）變化地
  short_varied:   { "<119": 27.27, "120-124": 48.0, "125-129": 46.67, "130+": 57.14 },
  // 中長途（>1200m）正常地
  midlong_normal: { "<119": 37.5,  "120-124": 46.2, "125-129": 54.5,  "130+": 60.0  },
  // 中長途（>1200m）變化地
  midlong_varied: { "<119": 37.5,  "120-124": 36.11,"125-129": 40.54, "130+": 37.5  },
};
```

**各地況排名對比（正常地 vs 變化地差異顯著）：**

| 地況 | 第1位 | 第2位 | 第3位 | 第4位 |
|---|---|---|---|---|
| 短途正常地 | 120-124（57.8%）| 130+（57.1%）| <119（50.0%）| 125-129（25.0%）|
| 短途變化地 | 130+（57.14%）| 120-124（48.0%）| 125-129（46.67%）| <119（27.27%）|
| 中長途正常地 | 130+（60.0%）| 125-129（54.5%）| 120-124（46.2%）| <119（37.5%）|
| 中長途變化地 | 125-129（40.54%）| 130+（37.5%）| <119（37.5%）| 120-124（36.11%）|

---

### 2.2 四大核心參數

```typescript
// 來源：weight_formula.txt / newform_v2.txt
interface HorseParams {
  Weight:      number;  // 負磅（直接負重）
  WeightD:     number;  // 負磅 × 路程（負距乘積）
  WeightRatio: number;  // (負磅 ÷ 馬體重) × 100%
  WeightRD:    number;  // (負磅 ÷ 馬體重) × 路程（累積相對負擔）
}

function calcParams(weight: number, horseWeight: number, distance: number): HorseParams {
  return {
    Weight:      weight,
    WeightD:     weight * distance,
    WeightRatio: +((weight / horseWeight) * 100).toFixed(2),
    WeightRD:    +((weight / horseWeight) * distance).toFixed(1),
  };
}

// WeightRD 動態基準值表（按距離線性插值，非固定 11.0）
const WEIGHTRDBENCHMARKS: Record<number, number> = {
  1000: 110, 1200: 140, 1400: 170, 1600: 200,
  1800: 230, 2000: 260, 2200: 290, 2400: 320,
};

function getBenchmark(distance: number): number {
  const keys = Object.keys(WEIGHTRDBENCHMARKS).map(Number).sort((a, b) => a - b);
  if (distance <= keys[0])  return WEIGHTRDBENCHMARKS[keys[0]];
  if (distance >= keys[keys.length - 1]) return WEIGHTRDBENCHMARKS[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    const d1 = keys[i], d2 = keys[i + 1];
    if (distance >= d1 && distance <= d2) {
      const b1 = WEIGHTRDBENCHMARKS[d1], b2 = WEIGHTRDBENCHMARKS[d2];
      return b1 + (b2 - b1) * ((distance - d1) / (d2 - d1));
    }
  }
  return 150;
}
```

---

### 2.3 評分上限（按班次，非固定 100）

```typescript
// 來源：newform_v2.txt — ScoringEngine.getRatingCeiling()
const CLASS_CEILING: Record<string, number> = {
  A3: 120,  // 最高班
  A2: 105,
  A1: 90,
  A:  75,
  B:  60,
  C:  45,
  D:  30,   // 最低班
};

// 正確計算：ratingScore = min(1.0, rating / ceiling)
const ratingScore = Math.min(1.0, horse.rating / CLASS_CEILING[raceClass]);
```

---

### 2.4 年齡成熟度分析

```typescript
// 來源：script_1.txt — AgeAnalyzer
type AgeStage = "risingstar" | "primewarrior" | "veteran";

const AGE_COEFFICIENTS: Record<AgeStage, number> = {
  risingstar:  0.8,   // 2–3 歲：潛力新星，給予加成修正
  primewarrior: 1.0,  // 4–5 歲：生理心理黃金期
  veteran:     0.9,   // 6+ 歲：經驗豐富但需警惕機能下滑
};

function classifyAge(age: number): AgeStage {
  if (age <= 3) return "risingstar";
  if (age <= 5) return "primewarrior";
  return "veteran";
}

// 狀態評估：根據近期成績動態評定
function assessCondition(stage: AgeStage, recentResults: number[]): string {
  if (!recentResults.length) return "初出";
  const avg  = recentResults.reduce((a, b) => a + b, 0) / recentResults.length;
  const best = Math.min(...recentResults);

  if (stage === "risingstar") {
    if (recentResults.length >= 2 && recentResults[0] < recentResults[recentResults.length - 1])
      return "上升中";
    return "需觀察";
  }
  if (stage === "primewarrior") {
    if (avg <= 3)  return "狀態佳";
    if (avg <= 7)  return "穩定";
    return "狀態欠佳";
  }
  // veteran
  if (best <= 3)  return "寶刀未老";
  if (best <= 6)  return "穩定";
  return "力不從心";
}

// 狀態乘數（最終評分必須乘以此值）
const CONDITION_MULTIPLIER: Record<string, number> = {
  "上升中":   1.2,
  "狀態佳":   1.1,
  "寶刀未老": 1.1,
  "穩定":     1.0,
  "需觀察":   1.0,
  "初出":     1.0,
  "狀態欠佳": 0.9,
  "力不從心": 0.8,
};
```

---

### 2.5 自適應權重機制（核心）

> ❌ 原 MD 使用固定權重 0.4/0.3/0.2/0.1，此為錯誤。系統按路程及班次動態調整：

```typescript
// 來源：newform_v2.txt — ScoringEngine.getAdaptiveWeights()
interface Weights {
  statistical: number;
  burden:      number;
  rating:      number;
  age:         number;
}

function getAdaptiveWeights(distance: number, raceClass: string): Weights {
  const w: Weights = { statistical: 0.40, burden: 0.30, rating: 0.20, age: 0.10 };

  // 路程調整
  if (distance <= 1200) {
    w.burden  = 0.35;  // 短途加重負擔分析
    w.rating  = 0.15;
  } else if (distance >= 2000) {
    w.statistical = 0.35;  // 長途加重統計勝率
    w.rating      = 0.25;
  }

  // 班次調整
  if (["A3", "A2", "A1"].includes(raceClass)) {
    w.rating      = 0.30;  // 高班加重個人實力
    w.statistical = 0.35;
  } else if (["C", "D"].includes(raceClass)) {
    w.burden = 0.25;
    w.age    = 0.15;  // 低班加重年齡狀態
  }

  return w;
}
```

---

### 2.6 完整綜合評分公式

```typescript
// 來源：newform_v2.txt — ScoringEngine.calculateComprehensiveScore()
function calculateComprehensiveScore(
  horse:     HorseData,
  raceInfo:  RaceInfo,
): AnalysisResult {
  const params    = calcParams(horse.weight, horse.horseWeight, raceInfo.distance);
  const benchmark = getBenchmark(raceInfo.distance);
  const weights   = getAdaptiveWeights(raceInfo.distance, raceInfo.raceClass);

  // 統計分數（維度一）
  const statRate  = getStatRate(horse.weight, raceInfo);
  const statScore = (statRate / 100) * weights.statistical;

  // 負擔分數（維度二）—— 基準值動態插值，非固定 11.0
  const burdenScore = Math.max(0, (benchmark - params.WeightRD) / benchmark) * weights.burden;

  // 評分分數（維度三）—— 上限按班次，非固定 100
  const ceiling     = CLASS_CEILING[raceInfo.raceClass] ?? 60;
  const ratingScore = Math.min(1.0, horse.rating / ceiling) * weights.rating;

  // 年齡加成（維度四）
  const stage       = classifyAge(horse.age);
  const ageScore    = AGE_COEFFICIENTS[stage] * weights.age;

  // 原始分數（0–100）
  const rawScore = (statScore + burdenScore + ratingScore + ageScore) * 100;

  // 狀態調整乘數（不可省略！）
  const condition   = assessCondition(stage, horse.recentResults ?? []);
  const multiplier  = CONDITION_MULTIPLIER[condition] ?? 1.0;

  const finalScore  = +(rawScore * multiplier).toFixed(1);

  // 評級
  const grade = finalScore >= 80 ? "A" :
                finalScore >= 60 ? "B" :
                finalScore >= 40 ? "C" : "D";

  return { ...params, statRate, stage, condition, multiplier,
           rawScore: +rawScore.toFixed(1), finalScore, grade };
}
```

---

### 2.7 第四維度：時間差計算

```typescript
// 來源：time_race.txt / weight_formula.txt
const DIST_COEFF: Record<string, number> = {
  short:   0.055,  // ≤1200m
  mid:     0.11,   // 1400–1650m
  midlong: 0.16,   // 1800–2000m
  long:    0.22,   // ≥2200m
};

const GROUND_MOD: Record<string, number> = {
  firm:     1.00,
  good:     1.05,
  yielding: 1.15,
  soft:     1.30,
};

// 跑法修正：長途後追額外加重
const STYLE_MOD: Record<string, Record<string, number>> = {
  short:   { leader: 0.95, prominent: 1.00, midfield: 1.00, rear: 1.05 },
  midlong: { leader: 0.95, prominent: 1.00, midfield: 1.00, rear: 1.10 },
};

function calcTimeDiff(
  deltaWeight: number,  // 該馬負磅 − 場均負磅
  distCat:    string,
  ground:     string,
  style:      string,
): number {
  const c       = DIST_COEFF[distCat]  ?? 0.11;
  const fGround = GROUND_MOD[ground]   ?? 1.00;
  const styleMod = distCat === "long"
    ? STYLE_MOD.midlong[style] ?? 1.00
    : STYLE_MOD.short[style]  ?? 1.00;

  return +((deltaWeight / 2) * c * fGround * styleMod).toFixed(3);
  // 正值 = 負磅高於場均 = 時間劣勢
  // 負值 = 負磅低於場均 = 時間優勢
}
```

---

### 2.8 步速預測（新增模組）

```typescript
type PaceType = "slow" | "normal" | "fast";

function predictPace(horses: HorseData[]): {
  pace: PaceType; leaderCount: number; frontRatio: number;
} {
  const leaders   = horses.filter(h => h.style === "leader").length;
  const prominent = horses.filter(h => h.style === "prominent").length;
  const frontRatio = (leaders + prominent) / horses.length;

  const pace: PaceType =
    leaders >= 4 || frontRatio > 0.6 ? "fast" :
    leaders <= 1 && frontRatio < 0.3 ? "slow" : "normal";

  return { pace, leaderCount: leaders, frontRatio: +frontRatio.toFixed(2) };
}

// 步速對不同跑法的評分修正
const PACE_BONUS: Record<PaceType, Record<string, number>> = {
  fast:   { leader: -0.05, prominent: -0.02, midfield:  0.02, rear: +0.08 },
  slow:   { leader: +0.08, prominent: +0.04, midfield:  0.00, rear: -0.05 },
  normal: { leader:  0.00, prominent:  0.00, midfield:  0.00, rear:  0.00 },
};
```

---

### 2.9 檔位群組走勢（新增模組）

```typescript
type TrackBias = "inner" | "outer" | "neutral";

interface DrawAnalysis {
  group:    "inner" | "mid" | "outer";
  bonus:    number;
  hasEdge:  boolean;
}

function analyzeDrawBias(
  draw:         number,
  totalRunners: number,
  bias:         TrackBias,
  style:        string,
): DrawAnalysis {
  const innerThreshold = Math.ceil(totalRunners * 0.3);
  const outerThreshold = Math.floor(totalRunners * 0.7);

  const group =
    draw <= innerThreshold ? "inner" :
    draw >= outerThreshold ? "outer" : "mid";

  let bonus = 0;
  if (bias === "inner" && group === "inner" && ["leader","prominent"].includes(style))
    bonus = +0.05;
  else if (bias === "outer" && group === "outer" && style === "rear")
    bonus = +0.03;
  else if (bias === "inner" && group === "outer" && style === "rear")
    bonus = -0.04;  // 劣勢

  return { group, bonus, hasEdge: bonus > 0 };
}
```

---

### 2.10 Softmax 勝率歸一化

```typescript
// 將全場馬匹評分轉換為總和 100% 的模擬勝率
function softmaxWinRates(horses: AnalyzedHorse[], temperature = 20): AnalyzedHorse[] {
  const expScores = horses.map(h => Math.exp(h.finalScore / temperature));
  const sumExp    = expScores.reduce((a, b) => a + b, 0);

  return horses.map((h, i) => ({
    ...h,
    simulatedWinRate: +((expScores[i] / sumExp) * 100).toFixed(2),
  }));
  // temperature 越高 → 分佈越均勻；越低 → 強者勝率越突出
}
```

---

## 3. 實時資金流追蹤

### 3.1 彩池逆向推算單馬投注額

```typescript
// WIN Pool 抽水率 17.5%，保留 82.5%
const POOL_DEDUCTION = 0.825;

// 獨贏（WIN）：單馬投注額反推
function estimateWinInvestment(
  horseOdds:  number,   // 該馬即時獨贏賠率
  totalPool:  number,   // WIN 彩池總額
): number {
  return (totalPool * POOL_DEDUCTION) / horseOdds;
}

// 連贏（QIN）/ 位置Q（QPL）：組合聚合資金
// 反推某馬在所有相關組合中的總受注額
function aggregateQINInvestment(
  horseNo:      number,
  qinOdds:      Record<string, number>,  // { "1-2": 8.5, "1-3": 12.0, ... }
  totalQINPool: number,
): number {
  const relatedCombos = Object.entries(qinOdds).filter(([key]) => {
    const [h1, h2] = key.split("-").map(Number);
    return h1 === horseNo || h2 === horseNo;
  });

  return relatedCombos.reduce((sum, [, odds]) => {
    return sum + (totalQINPool * POOL_DEDUCTION) / odds;
  }, 0);
}

// 孖寶（DBL）：追蹤跨場次資金
// 分析上一場熱門馬 → 下一場綁定目標
function analyzeDailyDouble(
  prevWinnerNo:   number,
  dblCombinations: Record<string, number>,  // { "3-1": 15.0, "3-5": 8.0, ... }
  totalDBLPool:   number,
): { targetHorse: number; estimatedAmount: number }[] {
  return Object.entries(dblCombinations)
    .filter(([key]) => key.startsWith(`${prevWinnerNo}-`))
    .map(([key, odds]) => ({
      targetHorse:     parseInt(key.split("-")[1]),
      estimatedAmount: (totalDBLPool * POOL_DEDUCTION) / odds,
    }))
    .sort((a, b) => b.estimatedAmount - a.estimatedAmount);
}
```

---

### 3.2 資金異動警報

```typescript
interface OddsSnapshot { timestamp: number; odds: number; estimatedInvestment: number; }

function detectMoneyAlert(
  history: OddsSnapshot[],  // 過去 15 分鐘快照
  alertThreshold = 0.30,    // 賠率下跌 30% 觸發警報
): "large_bet" | "steady" | "drifting" {
  if (history.length < 2) return "steady";
  const first = history[0].odds;
  const last  = history[history.length - 1].odds;
  const change = (first - last) / first;   // 正值 = 賠率下跌 = 資金湧入

  if (change >= alertThreshold) return "large_bet";  // 🟢 大戶落飛
  if (change <= -0.20)          return "drifting";   // 🔴 資金撤離
  return "steady";
}
```

---

## 4. 期望值 (EV) 運算引擎

### 4.1 正確 EV 公式（含抽水修正）

> ❌ 原 MD 的 `EV = 勝率 × 賠率 − 1` 未扣除馬會抽水，結果偏樂觀。

```typescript
// 正確版本：HKJC WIN 彩池保留 82.5%
const HKJC_DEDUCTION = 0.825;

function calcEV(simulatedWinRate: number, currentOdds: number): EVResult {
  // 隱含勝率（賠率所反映的市場預期）
  const impliedProb = HKJC_DEDUCTION / currentOdds;

  // 期望值：每投 $1 的預期回報
  const ev = (simulatedWinRate / 100) * currentOdds * HKJC_DEDUCTION - 1;

  // 邊際值：系統勝率 vs 市場隱含勝率的差距
  const edge = (simulatedWinRate / 100) - impliedProb;

  return {
    ev:          +ev.toFixed(3),
    impliedProb: +(impliedProb * 100).toFixed(2),
    edge:        +(edge * 100).toFixed(2),
    verdict:
      ev > 0.10  ? "strong_value" :   // ✅ 強值博：EV > +10%
      ev > 0     ? "marginal_value" : // 🟡 邊際值博：EV 0–10%
      ev > -0.15 ? "fair"           : // ⚪ 合理：EV -15% 至 0
                   "overbet",         // 🔴 過熱：EV < -15%
  };
}
```

---

### 4.2 多彩池 EV 矩陣

```typescript
// 同時計算 WIN / PLA / QIN / QPL 的 EV
function buildEVMatrix(horse: AnalyzedHorse, poolOdds: PoolOdds): EVMatrix {
  return {
    WIN: calcEV(horse.simulatedWinRate, poolOdds.win),
    PLA: calcEV(horse.simulatedPlaceRate, poolOdds.place),    // 模擬位置率 ≈ 勝率 × 2.5
    QIN: calcQINEV(horse, poolOdds.qin),                      // 最佳 QIN 組合 EV
    QPL: calcQPLEV(horse, poolOdds.qpl),                      // 最佳 QPL 組合 EV
  };
}
```

---

## 5. React 系統架構

### 5.1 技術棧

| 層次 | 技術選型 | 理由 |
|---|---|---|
| 前端框架 | React 18 + Vite + TypeScript | 嚴格型別，防止公式計算錯誤 |
| **數據獲取** | **TanStack Query (React Query)** | 內建 `refetchInterval`、快取、stale-time，優於 Zustand |
| 全域狀態 | Zustand | 僅用於 UI 狀態（主題、場次選擇），不用於輪詢數據 |
| UI 樣式 | Tailwind CSS v4 | 快速構建響應式介面 |
| 動畫 | Framer Motion | 數字跳動、EV 色彩過渡動畫 |
| 圖表 | Recharts | 資金流向折線圖、EV 分佈熱圖 |
| 後端代理 | Next.js API Routes | 繞過 CORS，統一管理 HKJC Headers |

### 5.2 組件樹

```
App/
 ├── providers/
 │    ├── QueryProvider           # TanStack Query 設定（輪詢頻率、重試策略）
 │    └── ThemeProvider           # 深色/淺色主題
 │
 ├── layout/
 │    ├── Header/                 # 場次切換、倒計時、主題切換
 │    └── MobileTabBar/           # 手機底部導航（數據 / 資金 / 建議）
 │
 ├── features/
 │    ├── RaceSetup/              # 賽事參數輸入（路程、場地、班次、檔位偏差）
 │    ├── HorseInputTable/        # 馬匹資料輸入（含近期成績、跑法）
 │    │
 │    ├── AnalyticsDashboard/     # 主儀表板（桌面 Bento Grid）
 │    │    ├── EVMatrixTable/     # ⭐ 核心：EV 值排名表（含所有維度）
 │    │    ├── PaceDrawMap/       # 步速地圖 + 檔位群組視覺化
 │    │    └── PoolSummary/       # 各彩池總額實時跑馬燈
 │    │
 │    ├── MoneyFlow/
 │    │    ├── WinPoolChart/      # 獨贏資金流向折線圖（15 分鐘歷史）
 │    │    ├── QINHeatmap/        # QIN/QPL 組合資金熱力圖
 │    │    └── AlertFeed/         # 大戶落飛即時警報列表
 │    │
 │    └── Recommendations/        # AI 自然語言投注建議卡片
 │
 └── shared/
      ├── NumberTicker/           # 數字跳動動畫組件
      ├── EVBadge/                # EV 值徽章（顏色編碼）
      └── GradeBadge/             # A/B/C/D 評級徽章
```

### 5.3 自訂 Hooks

```typescript
// ✅ 使用 TanStack Query 管理輪詢，取代 Zustand 手動計時器
function useHKJCPools(venue: string, date: string, raceNo: number) {
  return useQuery({
    queryKey:        ["pools", venue, date, raceNo],
    queryFn:         () => fetchPoolsViaProxy(venue, date, raceNo),
    refetchInterval: 30_000,   // 每 30 秒更新一次
    staleTime:       25_000,   // 25 秒內視為新鮮，不重複請求
    retry:           (count, err: any) => count < 3 && err?.status !== 403,
    enabled:         !!venue && !!date && raceNo > 0,
  });
}

function useHKJCOdds(venue: string, date: string, raceNo: number) {
  return useQuery({
    queryKey:        ["odds", venue, date, raceNo],
    queryFn:         () => fetchOddsViaProxy(venue, date, raceNo),
    refetchInterval: 15_000,   // 賠率變化快，每 15 秒更新
    staleTime:       10_000,
  });
}

// EV 計算器：自動響應賠率更新
function useEVCalculator(horses: AnalyzedHorse[], odds: PoolOdds | undefined) {
  return useMemo(() => {
    if (!odds || !horses.length) return [];
    const withWinRate = softmaxWinRates(horses);
    return withWinRate.map(h => ({
      ...h,
      ev:    buildEVMatrix(h, odds),
      alert: detectMoneyAlert(h.oddsHistory ?? []),
    }));
  }, [horses, odds]);
}

// 大戶落飛警報
function useSmartAlerts(oddsHistory: Record<number, OddsSnapshot[]>) {
  return useMemo(() => {
    return Object.entries(oddsHistory)
      .map(([horseNo, history]) => ({
        horseNo:    parseInt(horseNo),
        alertType:  detectMoneyAlert(history),
      }))
      .filter(a => a.alertType !== "steady");
  }, [oddsHistory]);
}
```

### 5.4 資料流架構

```
HKJC GraphQL API
       │
       ▼
Next.js API Proxy (/api/race-data)
  ├─ Header 輪換（User-Agent, Referer）
  ├─ Exponential Backoff (429 處理)
  └─ Response 正規化
       │
       ▼
TanStack Query (Client Cache Layer)
  ├─ useHKJCOdds    ← 每 15 秒
  └─ useHKJCPools   ← 每 30 秒
       │
       ▼
useEVCalculator (useMemo)
  ├─ softmaxWinRates()
  ├─ calcEV()       ← 含正確抽水修正
  └─ detectMoneyAlert()
       │
       ▼
UI Components (React)
  ├─ EVMatrixTable  (排名 + EV 顏色)
  ├─ MoneyFlowChart (資金趨勢)
  └─ Recommendations (自然語言建議)
```

---

## 6. 人性化介面設計

### 6.1 EV 顏色語義系統

```typescript
const EV_COLORS = {
  strong_value:   "#10b981",  // 翠綠：EV > +10%，強力推薦
  marginal_value: "#f59e0b",  // 琥珀：EV 0–10%，值得考慮
  fair:           "#6b7280",  // 灰色：EV -15% 至 0，合理
  overbet:        "#ef4444",  // 紅色：EV < -15%，過熱避開
};

// 賠率更新時的背景閃爍
const ODDS_FLASH = {
  drop: "animate-flash-green",   // 賠率下跌 = 資金湧入 = 綠色閃爍
  rise: "animate-flash-red",     // 賠率上升 = 資金撤離 = 紅色閃爍
};
```

### 6.2 步速地圖（PaceDrawMap）視覺化

```
步速預測：快節奏 ⚡              檔位偏差：利內檔
┌─────────────────────────────────┐
│  前位區                         │
│  ┌────┐ ┌────┐ ┌────┐          │
│  │ 1  │ │ 3  │ │ 7  │  ← 領放   │
│  └────┘ └────┘ └────┘          │
│                                 │
│  中位區                         │
│  ┌────┐ ┌────┐                  │
│  │ 5  │ │ 9  │  ← 跟前/中置    │
│  └────┘ └────┘                  │
│                                 │
│  後位區                         │
│  ┌────┐ ┌────┐ ┌────┐          │
│  │ 2  │ │ 6  │ │11  │  ← 後追   │
│  └────┘ └────┘ └────┘          │
│  內 ◄─────────────────► 外     │
└─────────────────────────────────┘
● 綠框 = 步速/檔位雙優勢  ● 紅框 = 劣勢  ● 灰框 = 中性
```

### 6.3 EVMatrixTable 欄位設計（桌面版）

| 欄位 | 說明 |
|---|---|
| 排名 | 按綜合評分排列 |
| 馬號 / 馬名 | 固定列（手機捲動時保留） |
| 評級 (A/B/C/D) | 色彩徽章 |
| 系統勝率 % | Softmax 歸一化後的模擬勝率 |
| 即時賠率 | 實時更新，附上升/下跌箭頭 |
| 推算投注額 | WIN 池逆向計算，單位：萬港元 |
| QIN 聚合資金 | 該馬所有連贏組合的累計受注估算 |
| **EV 值** | 顏色編碼，核心決策指標 |
| 時間差 (s) | 對比場均負磅的時間優劣勢 |
| ⚠️ 警報 | 大戶落飛 / 重磅 / 初出等標記 |

### 6.4 Bento Grid 佈局（桌面 1280px+）

```
┌───────────────────────────┬──────────────────┐
│                           │   資金雷達        │
│   EVMatrixTable           │  QIN/QPL 熱力圖  │
│   （全場 EV 排名）         │                  │
│                           ├──────────────────┤
│                           │   步速 + 檔位    │
│                           │   PaceDrawMap    │
├───────────────────────────┴──────────────────┤
│   MoneyFlowChart（15 分鐘賠率走勢折線圖）     │
├──────────────────────────────────────────────┤
│   AI 投注建議（自然語言卡片）                 │
└──────────────────────────────────────────────┘
```

### 6.5 AI 自然語言建議範例

```
🥇 首選推薦：3 號馬「金風快劍」
   系統勝率 22.4% ｜即時賠率 8.5 ｜EV = +0.91 ✅ 強值博
   WeightRD = 168.0（低於基準 170，負擔輕微優勢）
   QPL 聚合資金異常湧入，大戶目標特徵明顯。
   建議：WIN + QPL（3 + 任何 A 級馬）複式策略。

⚠️  注意：1 號馬「飛馬傳說」EV = −0.22（過熱警告）
   市場已消化其優勢，賠率偏低，值博率不足。
```

---

## 7. API 整合實作

### 7.1 後端代理（Next.js API Route）

```typescript
// pages/api/race-data/[...params].ts
import { getRaceOdds, getRacePools } from "hkjc-api";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.status === 429) {
        // Exponential Backoff + Jitter
        const wait = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

export default async function handler(req, res) {
  const { venue, date, raceNo } = req.query;

  try {
    // 平行獲取，減少等待時間
    const [winPla, qin, qpl, pools] = await Promise.all([
      fetchWithRetry(() => getRaceOdds(date, venue, raceNo, ["WIN", "PLA"])),
      fetchWithRetry(() => getRaceOdds(date, venue, raceNo, ["QIN"])),
      fetchWithRetry(() => getRaceOdds(date, venue, raceNo, ["QPL"])),
      fetchWithRetry(() => getRacePools(date, venue, raceNo)),
    ]);

    // 後端預計算單馬投注額，減輕前端計算負擔
    const enrichedHorses = winPla.WIN.map(horse => ({
      horseNo:         horse.no,
      winOdds:         horse.odds,
      placeOdds:       winPla.PLA.find(p => p.no === horse.no)?.odds,
      estWinInvestment: (pools.WIN * 0.825) / horse.odds,
      estQINInvestment:  aggregateQINInvestment(horse.no, qin, pools.QIN),
      estQPLInvestment:  aggregateQINInvestment(horse.no, qpl, pools.QPL),
    }));

    res.status(200).json({ success: true, horses: enrichedHorses, pools });

  } catch (err) {
    res.status(500).json({ error: "API fetch failed", detail: err.message });
  }
}
```

### 7.2 請求頻率建議

| 場景 | 建議間隔 | 說明 |
|---|---|---|
| 賠率（WIN/PLA） | 每 15 秒 | 賠率變化快，需較高頻率 |
| 彩池總額 | 每 30 秒 | 金額變化相對平穩 |
| QIN/QPL 組合 | 每 60 秒 | 組合數量多，頻繁請求易觸發封鎖 |
| 開跑前最後 5 分鐘 | 每 10 秒 | 大戶最後落飛窗口，提高密度 |
| 賽後結果 | 一次性 | 開跑後停止輪詢，僅獲取結果 |

---

## 8. 部署與優化路線圖

### Phase 1：MVP（即時分析）
- [x] 四維度分析引擎（含修正版公式）
- [x] HKJC GraphQL 代理 + 基本賠率獲取
- [x] EV 計算（WIN / PLA）
- [x] 基本步速預測

### Phase 2：資金流追蹤
- [ ] 15 分鐘賠率歷史快照
- [ ] QIN / QPL 組合聚合資金
- [ ] 大戶落飛警報系統
- [ ] DBL 孖寶跨場次資金追蹤

### Phase 3：回測與優化
- [ ] 歷史賽事 EV 預測結果存入 Supabase
- [ ] 實際 ROI 追蹤儀表板
- [ ] 四維度權重自動校準（基於歷史回測數據）
- [ ] WebSocket 升級（Socket.io 推送，取代輪詢）

---

> ⚠️ **免責聲明**：本系統純為學術研究及個人數據分析用途，不構成任何投注建議。賽馬活動存在不確定性，請理性對待，量力而為。
