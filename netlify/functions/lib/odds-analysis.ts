// ══════════════════════════════════════════════════════════════════════════════
// Odds Structure Analysis - 基於香港賽馬專業理論
// 賠率分類標準：od1(1-9.9熱門) / od2(10-19.9半冷) / od3(20-99冷馬)
// ══════════════════════════════════════════════════════════════════════════════

import type { OddsStructureResult, RunnerPrediction } from './types'

/**
 * 賠率分類標準
 * - od1: 1.0 - 9.9 (熱門馬)
 * - od2: 10.0 - 19.9 (半冷門馬)
 * - od3: 20.0 - 99.9 (冷馬)
 */
export const ODDS_RANGES = {
  OD1_MIN: 1.0,
  OD1_MAX: 9.9,
  OD2_MIN: 10.0,
  OD2_MAX: 19.9,
  OD3_MIN: 20.0,
  OD3_MAX: 99.9,
} as const

/**
 * 將賠率分類為 od1/od2/od3
 */
export function classifyOdds(odds: number): 'od1' | 'od2' | 'od3' {
  if (odds >= ODDS_RANGES.OD1_MIN && odds < ODDS_RANGES.OD2_MIN) {
    return 'od1'
  } else if (odds >= ODDS_RANGES.OD2_MIN && odds < ODDS_RANGES.OD3_MIN) {
    return 'od2'
  } else {
    return 'od3'
  }
}

/**
 * 計算各賠率分類的馬匹數量
 */
export function countOddsDistribution(predictions: RunnerPrediction[]): {
  od1Count: number
  od2Count: number
  od3Count: number
  oddsPattern: string
} {
  const withOdds = predictions.filter(
    (p) => p.winOdds !== '—' && !isNaN(parseFloat(String(p.winOdds)))
  )

  const od1Count = withOdds.filter((p) => {
    const odds = parseFloat(String(p.winOdds))
    return odds >= ODDS_RANGES.OD1_MIN && odds < ODDS_RANGES.OD2_MIN
  }).length

  const od2Count = withOdds.filter((p) => {
    const odds = parseFloat(String(p.winOdds))
    return odds >= ODDS_RANGES.OD2_MIN && odds < ODDS_RANGES.OD3_MIN
  }).length

  const od3Count = withOdds.filter((p) => {
    const odds = parseFloat(String(p.winOdds))
    return odds >= ODDS_RANGES.OD3_MIN
  }).length

  return {
    od1Count,
    od2Count,
    od3Count,
    oddsPattern: `${od1Count}/${od2Count}/${od3Count}`,
  }
}

/**
 * 分析賠率結構並判斷賽局類型
 * 
 * 規則：
 * - 馬膽局：od1 ≤ 3
 * - 混亂局：od1 ≈ 4 (3.5 ~ 5.5範圍)
 * - 分立局：od1 > 5.5
 */
export function analyzeOddsStructure(
  predictions: RunnerPrediction[],
  isPreRace: boolean
): OddsStructureResult {
  const NA: OddsStructureResult = {
    raceType: '未能判斷',
    raceTypeCode: 'UNKNOWN',
    od1: 0,
    od2: 0,
    od3: 0,
    od4: 0,
    od1Count: 0,
    od2Count: 0,
    od3Count: 0,
    oddsPattern: '—/—/—',
    hotCount: 0,
    coldSignal: false,
    qinFocus: 'unknown',
    topBanker: null,
    coldCandidates: [],
    description: isPreRace
      ? '賠率未開盤，暫無法判斷賽局結構。'
      : '賽駒不足，無法判斷賽局結構。',
    tip: '等待賠率開盤後分析。',
  }

  const withOdds = predictions
    .filter(
      (p) =>
        p.winOdds !== '—' &&
        !isNaN(parseFloat(String(p.winOdds))) &&
        !String(p.runnerNumber).startsWith('R')
    )
    .sort((a, b) => parseFloat(String(a.winOdds)) - parseFloat(String(b.winOdds)))

  if (withOdds.length < 4) return NA

  // 提取前四名賠率
  const od1 = parseFloat(String(withOdds[0].winOdds))
  const od2 = parseFloat(String(withOdds[1].winOdds))
  const od3 = parseFloat(String(withOdds[2].winOdds))
  const od4 = withOdds[3] ? parseFloat(String(withOdds[3].winOdds)) : 99

  // 計算 od1/od2/od3 分類數量（基於新標準）
  const { od1Count, od2Count, od3Count, oddsPattern } = countOddsDistribution(predictions)

  const hotCount = od1Count // 熱門馬 = od1 範圍內的馬匹

  // 冷馬候選：od2 和 od3 中賠率 6-30 之間的馬
  const coldCandidates = withOdds
    .filter((p) => {
      const o = parseFloat(String(p.winOdds))
      return o >= 6 && o <= 30
    })
    .slice(0, 6)
    .map((p) => p.runnerNumber)

  const topBanker = withOdds[0].runnerNumber
    const od1Horse = withOdds[0]?.runnerNumber || ''
    const od2Horse = withOdds[1]?.runnerNumber || ''
    const od3Horse = withOdds[2]?.runnerNumber || ''
    const od4Horse = withOdds[3]?.runnerNumber || ''

  // ══════════════════════════════════════════════════════════════════════
  // 規則一：馬膽局 — od1 ≤ 3
  // ══════════════════════════════════════════════════════════════════════
  if (od1 <= 3) {
    let tip = `強膽黑 #${topBanker}(${od1}) 存在，建議(0)或焦點連結冷殺。`
          let qin: OddsStructureResult['qinFocus'] = 'od1_group

    if (od2 >= 4) {
      tip = `超強馬膽 #${topBanker}(${od1}) 配搭次強 #${od2Horse}(${od2})。Q經平穩定包含首選，宜以首選為膽連搭3至4匹暗。`    }

    return {
      raceType: '馬膽局',
      raceTypeCode: 'BANKER',
      od1,
      od2,
      od3,
      od4,
      od1Count,
      od2Count,
      od3Count,
      oddsPattern,
      hotCount,
      coldSignal: false,
      qinFocus: qin,
      topBanker: String(topBanker),
      coldCandidates: [],
      description: `馬膽局：超班馬膽存在（賠膽率 #${topBanker}(${od1})），熱門集中。賠率結構 ${oddsPattern} (od1熱門/od2半冷/od3冷馬)。`,      tip,
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 規則三：混亂局 — od1 ≈ 4（3.5 ~ 5.5範圍）
  // ══════════════════════════════════════════════════════════════════════
  if (od1 >= 3.5 && od1 <= 5.5) {
    const subColdSignal = od2 >= 4

    return {
      raceType: '混亂局',
      raceTypeCode: 'CHAOTIC',
      od1,
      od2,
      od3,
      od4,
      od1Count,
      od2Count,
      od3Count,
      oddsPattern,
      hotCount,
      coldSignal: true,
      qinFocus: 'od2_od3_group',
      topBanker: null,
      coldCandidates,
      description: `混亂局：首選賠率約4（${od1}）${
        subColdSignal ? `，次選同樣偏高（${od2}）` : ''
      }。賠率結構 ${oddsPattern}（od1:${od1Count} od2:${od2Count} od3:${od3Count}）。Q全在首選(od1)出現機率偏低，冷賽果信號強烈。`,
      tip: `⚠️ 冷賽果高危場：認真比較次選（${od2}）至第四選（${od4}）中的冷馬，特別留意年輕質新馬、配件改變馬、轉馬房馬。od2(半冷門)和od3(冷馬)中尋找合適膽腳。`,
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 規則二：分立局 — od1 > 5.5
  // ══════════════════════════════════════════════════════════════════════
  if (od2 >= 4) {
    const bothHigh = od1 >= 4 && od2 >= 4
    const coldSignal = bothHigh
    const qin: OddsStructureResult['qinFocus'] = bothHigh ? 'spread' : 'od1_group'

    const desc = bothHigh
      ? `分立局（混亂傾向）：首選（${od1}）與次選（${od2}）賠率差異不大，od1分層被od2瓦解。賠率結構 ${oddsPattern}（od1:${od1Count} od2:${od2Count} od3:${od3Count}）。整體局面仍混亂，冷馬機率上升。`
      : `分立局：熱門存在一定分層（首選 ${od1}，次選 ${od2}）。賠率結構 ${oddsPattern}（od1熱門數量 ${od1Count} 匹）。Q有較高概率在首選組別中出現。`

    const tip = bothHigh
      ? `od1與od2均≥4，冷馬結果機率高。可考慮在od2（${od2}）和od3附近尋找冷馬配搭。`
      : `Q聚焦首選#${topBanker}配搭2至3匹次選。熱門競爭多（${od1Count}匹），注碼宜分散。`

    return {
      raceType: '分立局',
      raceTypeCode: 'SPLIT',
      od1,
      od2,
      od3,
      od4,
      od1Count,
      od2Count,
      od3Count,
      oddsPattern,
      hotCount,
      coldSignal,
      qinFocus: qin,
      topBanker: coldSignal ? null : String(topBanker),
      coldCandidates: coldSignal ? coldCandidates : [],
      description: desc,
      tip,
    }
  }

  // Fallback: od1 > 5.5, od2 < 4 — 分立局（適中）
  return {
    raceType: '分立局',
    raceTypeCode: 'SPLIT',
    od1,
    od2,
    od3,
    od4,
    od1Count,
    od2Count,
    od3Count,
    oddsPattern,
    hotCount,
    coldSignal: false,
    qinFocus: 'od1_group',
    topBanker: String(topBanker),
    coldCandidates: [],
    description: `分立局：熱門競爭適中（首選 ${od1}，次選 ${od2}）。賠率結構 ${oddsPattern}（od1熱門數量 ${od1Count} 匹）。`,
    tip: `Q以首選#${topBanker}為主軸，配搭2至3匹次選。注意熱門較多時派彩偏低，子彈宜節省。`,
  }
}
