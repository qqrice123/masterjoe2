// src/services/weightRD.utils.ts
// ─── WeightRD × Odds Screening Framework ──────────────────────────────────────
// Framework definition (horse-racing-analysis-system.md):
//   WeightRD = (Weight / HorseWeight) × Distance
//   Benchmark = distance-interpolated from BENCHMARKS table
//   isGoldenWeightRD: odds ∈ [3, 9] AND WeightRD < benchmark × 0.90
//   isStrongStar:     odds ≤ 10     AND WeightRD < benchmark × 0.90
//   isBlueStar:       odds ∈ (9,20) AND WeightRD < benchmark × 0.95  (watchlist only)

// ─── Benchmark table (newform_v2.txt) ────────────────────────────────────────
const BENCHMARKS: Record<number, number> = {
  1000: 110,
  1200: 140,
  1400: 170,
  1600: 200,
  1800: 230,
  2000: 260,
  2200: 290,
  2400: 320,
}

export function getWeightRDBenchmark(distance: number): number {
  const keys = Object.keys(BENCHMARKS).map(Number).sort((a, b) => a - b)
  if (distance <= keys[0]) return BENCHMARKS[keys[0]]
  if (distance >= keys[keys.length - 1]) return BENCHMARKS[keys[keys.length - 1]]
  for (let i = 0; i < keys.length - 1; i++) {
    const d1 = keys[i], d2 = keys[i + 1]
    if (d1 <= distance && distance <= d2) {
      const b1 = BENCHMARKS[d1], b2 = BENCHMARKS[d2]
      return b1 + (b2 - b1) * ((distance - d1) / (d2 - d1))
    }
  }
  return 150 // fallback
}

// ─── Core calculation ─────────────────────────────────────────────────────────
export interface WeightRDFields {
  weightRD:          number
  weightRDBenchmark: number
  isGoldenWeightRD:  boolean   // ✨ primary: 3–9x × WeightRD < 90% benchmark
  goldenScore:       number    // % below benchmark (>0 = lighter than benchmark)
  isStrongStar:      boolean   // ★ yellow: ≤10x × WeightRD < 90% benchmark
  isBlueStar:        boolean   // ★ blue:  10–19.9x watchlist (95% threshold)
}

export function calculateWeightRDFields(
  weight:     number,  // carried weight (lbs)
  horseWeight:number,  // horse body weight (lbs)
  distance:   number,  // race distance (metres)
  winOdds:    number,  // current win odds (numeric)
): WeightRDFields {
  const weightRD          = (weight / horseWeight) * distance
  const weightRDBenchmark = getWeightRDBenchmark(distance)
  const deviationPct      = (weightRDBenchmark - weightRD) / weightRDBenchmark * 100
  const goldenScore       = parseFloat(deviationPct.toFixed(2))

  // ── Odds range gates (framework-defined) ──────────────────────────────────
  const inGoldenOdds = winOdds >= 3 && winOdds <= 9      // primary target band
  const inStarOdds   = winOdds > 0  && winOdds <= 10     // extended ≤10x
  const inBlueOdds   = winOdds > 9  && winOdds < 20      // watchlist 10–19.9x

  // ── WeightRD thresholds ───────────────────────────────────────────────────
  const isBelowPrimary  = weightRD < weightRDBenchmark * 0.90   // -10% or more
  const isBelowWatchlist= weightRD < weightRDBenchmark * 0.95   // -5% or more

  return {
    weightRD:          parseFloat(weightRD.toFixed(1)),
    weightRDBenchmark: parseFloat(weightRDBenchmark.toFixed(1)),
    isGoldenWeightRD:  inGoldenOdds && isBelowPrimary,   // ✨ primary signal
    goldenScore,
    isStrongStar:      inStarOdds   && isBelowPrimary,   // ★ yellow
    isBlueStar:        inBlueOdds   && isBelowWatchlist && !isBelowPrimary
                       // Blue = watchlist ONLY; doesn't overlap Golden/Strong
                       // Disable if not needed: set to false
  }
}

// ─── Tooltip labels for UI rendering ─────────────────────────────────────────
export function getWeightRDTooltip(fields: WeightRDFields): string {
  const { weightRD, weightRDBenchmark, goldenScore } = fields
  return `WeightRD ${weightRD} / 基準 ${weightRDBenchmark} (${goldenScore > 0 ? "-" : "+"}${Math.abs(goldenScore).toFixed(1)}%)`
}
