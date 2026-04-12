import type { Handler } from "@netlify/functions"
import { HorseRacingAPI, HKJCClient } from "hkjc-api"
import { horseOddsQuery, horsePoolQuery } from "hkjc-api/dist/query/horseRacingQuery.js"
import { neon } from "@neondatabase/serverless"

const horseAPI = new HorseRacingAPI()
const hkjcClient = new HKJCClient()

// ── Constants & Helpers ──────────────────────────────────────────────────
const STAT_WIN_RATES: Record<string, Record<string, number>> = {
  "短途正常地": {
    "130+": 57.1,
    "125-129": 25.0,
    "120-124": 57.8,
    "<119": 50.0,
  },
  "短途變化地": {
    "130+": 57.14,
    "125-129": 46.67,
    "120-124": 48.0,
    "<119": 27.27,
  },
  "中長途正常地": {
    "130+": 60.0,
    "125-129": 54.5,
    "120-124": 46.2,
    "<119": 37.5,
  },
  "中長途變化地": {
    "130+": 37.5,
    "125-129": 40.54,
    "120-124": 36.11,
    "<119": 37.5,
  },
}

const WEIGHTRD_BENCHMARKS: Record<number, number> = {
  1000: 110,
  1200: 140,
  1400: 170,
  1600: 200,
  1800: 230,
  2000: 260,
  2200: 290,
  2400: 320,
}

function getWeightRDBenchmark(distance: number): number {
  const distances = Object.keys(WEIGHTRD_BENCHMARKS)
    .map(Number)
    .sort((a, b) => a - b)
  if (distance <= distances[0]) return WEIGHTRD_BENCHMARKS[distances[0]]
  if (distance >= distances[distances.length - 1]) return WEIGHTRD_BENCHMARKS[distances[distances.length - 1]]
  for (let i = 0; i < distances.length - 1; i++) {
    const d1 = distances[i]
    const d2 = distances[i + 1]
    if (distance >= d1 && distance <= d2) {
      const b1 = WEIGHTRD_BENCHMARKS[d1]
      const b2 = WEIGHTRD_BENCHMARKS[d2]
      return b1 + ((b2 - b1) * (distance - d1)) / (d2 - d1)
    }
  }
  return 140
}

function getRatingMax(raceClass: string): number {
  const cls = raceClass.toUpperCase()
  if (cls === "A1" || cls.includes("CLASS 1") || cls === "G1" || cls.includes("GROUP 1")) return 90
  if (cls === "A2" || cls.includes("CLASS 2") || cls === "G2" || cls.includes("GROUP 2")) return 105
  if (cls === "A3" || cls.includes("CLASS 3") || cls === "G3" || cls.includes("GROUP 3")) return 120
  if (cls === "A") return 75
  if (cls === "B") return 60
  if (cls === "C") return 45
  return 30
}

const AGE_FACTORS: Record<string, number> = {
  "2-3歲": 0.8,
  "4-5歲": 1.0,
  "6-10歲": 0.9,
}

function estimateAge(code: string): number {
  if (!code) return 4
  const letter = code.charAt(0).toUpperCase()
  const seasonMap: Record<string, number> = {
    N: 2,
    M: 3,
    L: 3,
    K: 4,
    J: 5,
    H: 6,
    G: 7,
    E: 8,
    D: 9,
    C: 10,
  }
  return seasonMap[letter] || 5
}

function getConditionMult(last3Form: string): number {
  const positions = last3Form.split(/[/\-]/).map(Number).filter((n) => !isNaN(n) && n > 0)
  if (positions.length === 0) return 1.0
  const avg = positions.reduce((a, b) => a + b, 0) / positions.length
  if (positions[0] <= 2 && avg <= 3) return 1.2
  if (positions[0] <= 3) return 1.1
  if (avg >= 8) return 0.8
  if (avg >= 6) return 0.9
  return 1.0
}

function getDynamicWeights(distance: number, raceClass: string) {
  let wStat = 0.35
  let wBurden = 0.25
  let wRating = 0.15
  let wAge = 0.1
  let wTime = 0.15

  const cls = raceClass.toUpperCase()
  const isHighClass =
    cls.includes("CLASS 1") ||
    cls.includes("CLASS 2") ||
    cls.includes("CLASS 3") ||
    cls === "A1" ||
    cls === "A2" ||
    cls === "A3" ||
    cls.includes("GROUP 1") ||
    cls.includes("GROUP 2") ||
    cls.includes("GROUP 3") ||
    cls.includes("G1") ||
    cls.includes("G2") ||
    cls.includes("G3")
  const isLowClass =
    cls.includes("CLASS 4") ||
    cls.includes("CLASS 5") ||
    cls === "A" ||
    cls === "B" ||
    cls === "C"

  if (distance <= 1200) {
    wBurden = 0.2
    wTime = 0.2
    wRating = 0.15
  } else if (distance >= 2000) {
    wStat = 0.35
    wRating = 0.2
    wTime = 0.05
  }

  if (isHighClass) {
    wRating = 0.25
    wStat = 0.3
  } else if (isLowClass) {
    wBurden = 0.2
    wAge = 0.15
  }

  const total = wStat + wBurden + wRating + wAge + wTime
  return {
    wStat: wStat / total,
    wBurden: wBurden / total,
    wRating: wRating / total,
    wAge: wAge / total,
    wTime: wTime / total,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ODDS STRUCTURE ANALYSIS — 基於香港賽馬專業理論
// 賠率分類：od1(1-9.9熱門) / od2(10-19.9半冷) / od3(20-99冷馬)
// 三大賽局：馬膽局(od1≤3) / 混亂局(od1=4) / 分立局(od1≥5)
// ══════════════════════════════════════════════════════════════════════════════
interface OddsStructureResult {
  raceType: "馬膽局" | "分立局" | "混亂局" | "未能判斷"
  raceTypeCode: "BANKER" | "SPLIT" | "CHAOTIC" | "UNKNOWN"
  od1: number
  od2: number
  od3: number
  od4: number
  od1Name?: string
  od2Name?: string
  od3Name?: string
  od4Name?: string
  od1Number?: string | number
  od2Number?: string | number
  od3Number?: string | number
  od4Number?: string | number
  od1Count: number
  od2Count: number
  od3Count: number
  oddsPattern: string
  hotCount: number
  coldSignal: boolean
  qinFocus: "od1_group" | "od2_od3_group" | "spread" | "unknown"
  topBanker: string | null
  coldCandidates: (string | number)[]
  description: string
  tip: string
}

function analyzeOddsStructure(
  predictions: any[],
  isPreRace: boolean
): OddsStructureResult {
  const NA: OddsStructureResult = {
    raceType: "未能判斷", raceTypeCode: "UNKNOWN",
    od1: 0, od2: 0, od3: 0, od4: 0,
    od1Count: 0, od2Count: 0, od3Count: 0,
    oddsPattern: "—/—/—",
    hotCount: 0, coldSignal: false,
    qinFocus: "unknown", topBanker: null, coldCandidates: [],
    description: isPreRace ? "賠率未開盤，暫無法判斷賽局結構。" : "賽駒不足，無法判斷賽局結構。",
    tip: "等待賠率開盤後分析。",
  }

  const withOdds = [...predictions]
    .filter(
      (p) =>
        p.winOdds !== "—" &&
        !isNaN(parseFloat(String(p.winOdds))) &&
        !String(p.runnerNumber).startsWith("R")
    )
    .sort((a, b) => parseFloat(String(a.winOdds)) - parseFloat(String(b.winOdds)))

  if (withOdds.length < 4) return NA

  const top4 = withOdds.slice(0, 4)
  const od1 = top4[0] ? parseFloat(String(top4[0].winOdds)) : 99
  const od2 = top4[1] ? parseFloat(String(top4[1].winOdds)) : 99
  const od3 = top4[2] ? parseFloat(String(top4[2].winOdds)) : 99
  const od4 = top4[3] ? parseFloat(String(top4[3].winOdds)) : 99

  const od1Name = top4[0]?.runnerName
  const od2Name = top4[1]?.runnerName
  const od3Name = top4[2]?.runnerName
  const od4Name = top4[3]?.runnerName

  const od1Number = top4[0]?.runnerNumber
  const od2Number = top4[1]?.runnerNumber
  const od3Number = top4[2]?.runnerNumber
  const od4Number = top4[3]?.runnerNumber

  const od1Count = withOdds.filter(p => parseFloat(String(p.winOdds)) < 10).length
  const od2Count = withOdds.filter(p => {
    const o = parseFloat(String(p.winOdds))
    return o >= 10 && o < 20
  }).length
  const od3Count = withOdds.filter(p => parseFloat(String(p.winOdds)) >= 20).length

  const oddsPattern = `${od1Count}/${od2Count}/${od3Count}`
  const hotCount = od1Count

  const coldCandidates = withOdds
    .filter(p => {
      const o = parseFloat(String(p.winOdds))
      return o >= 10 && o <= 30
    })
    .slice(0, 6)
    .map((p) => p.runnerNumber)

  const topBanker = withOdds[0].runnerNumber

  console.log(`[OddsStructure] od1Count=${od1Count} od2Count=${od2Count} od3Count=${od3Count} pattern=${oddsPattern} isPreRace=${isPreRace}`)

  // ══════════════════════════════════════════════════════════════════════
  // 規則一：馬膽局 — od1Count ≤ 3匹
  // ══════════════════════════════════════════════════════════════════════
  if (od1Count <= 3) {
    const tip = `強馬膽 #${topBanker}（${od1}）存在。連贏(Q)聚焦首選配搭次選。`
    const qin: OddsStructureResult["qinFocus"] = "od1_group"
    return {
      raceType: "馬膽局", raceTypeCode: "BANKER",
      od1, od2, od3, od4,
      od1Name, od2Name, od3Name, od4Name,
      od1Number, od2Number, od3Number, od4Number,
      od1Count, od2Count, od3Count, oddsPattern, hotCount,
      coldSignal: false,
      qinFocus: qin,
      topBanker: String(topBanker),
      coldCandidates: [],
      description: `馬膽局：熱門馬僅 ${od1Count} 匹，意味著有超班的馬膽存在，投注者一般都是圍繞這些強有力的馬膽來構築投注。賠率結構 ${oddsPattern}（熱門/半冷/冷馬）。`,
      tip,
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 規則三：混亂局 — od1Count = 4匹
  // ══════════════════════════════════════════════════════════════════════
  if (od1Count === 4) {
    return {
      raceType: "混亂局", raceTypeCode: "CHAOTIC",
      od1, od2, od3, od4,
      od1Name, od2Name, od3Name, od4Name,
      od1Number, od2Number, od3Number, od4Number,
      od1Count, od2Count, od3Count, oddsPattern, hotCount,
      coldSignal: true,
      qinFocus: "od2_od3_group",
      topBanker: null,
      coldCandidates,
      description: `混亂局：熱門馬剛好 ${od1Count} 匹，情況較為複雜。Q全在熱門(od1)中出現的情況較少，賽果強烈偏向於在 od2 和 od3 中出現冷門。`,
      tip: `⚠️ 冷賽果高危場：這是最值得注意的冷賽果信號，應認真比較研究該場賽事模式，特別從冷門馬中（特別是od3）尋找合適的膽和腳。`,
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 規則二：分立局 — od1Count ≥ 5匹
  // ══════════════════════════════════════════════════════════════════════
  if (od1Count > 4) {
    const isColdSplit = od2Count >= 4
    if (isColdSplit) {
      return {
        raceType: "分立局", raceTypeCode: "SPLIT",
        od1, od2, od3, od4,
        od1Name, od2Name, od3Name, od4Name,
        od1Number, od2Number, od3Number, od4Number,
        od1Count, od2Count, od3Count, oddsPattern, hotCount,
        coldSignal: true,
        qinFocus: "spread",
        topBanker: null,
        coldCandidates,
        description: `分立局（瓦解）：熱門馬（${od1Count}匹）與半冷馬（${od2Count}匹）均 ≥ 4匹。意味著 od1 的分層現象被 od2 所瓦解，整體局面依然是混亂不清的。`,
        tip: `od1 和 od2 並沒有賠率顯示的那樣有那麼大的差異，賽果有很大的機會可能會出現冷馬結果。`,
      }
    } else {
      const isStrongSplit = od2Count < 3
      return {
        raceType: "分立局", raceTypeCode: "SPLIT",
        od1, od2, od3, od4,
        od1Name, od2Name, od3Name, od4Name,
        od1Number, od2Number, od3Number, od4Number,
        od1Count, od2Count, od3Count, oddsPattern, hotCount,
        coldSignal: false,
        qinFocus: "od1_group",
        topBanker: String(topBanker),
        coldCandidates: [],
        description: `分立局：熱門馬達 ${od1Count} 匹，熱門或冷門出現了一定程度的分層現象。熱門相爭數量較多，賽果偏向較多熱門。`,
        tip: isStrongSplit
          ? `半冷馬（${od2Count}匹）< 3匹，分層現象更加明顯。有很大的機率 Q 基本上在 od1 中出現。`
          : `熱門競爭多，注意熱門馬匹間的連贏(Q)組合。`,
      }
    }
  }

  return NA
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  }
}

import { RunnerPrediction } from "./lib/types.js"

export const handler: Handler = async (event) => {
  try {
    const rawPath = event.path || ""
    const pathname = rawPath
      .replace(/^\/\.netlify\/functions\/api/, "")
      .replace(/^\/api/, "")
    const method = event.httpMethod || "GET"
    console.log("API request", { method, rawPath, pathname })

    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      return json(405, { error: "Method not allowed" })
    }

    // ── /meetings ──────────────────────────────────────────────────────────
    if (pathname === "/meetings") {
      try {
        const meetings = await horseAPI.getActiveMeetings()
        const formattedMeetings = meetings.map((m: any) => ({
          id: m.id,
          venue: m.venueCode === "HV" ? "跑馬地" : m.venueCode === "ST" ? "沙田" : m.venueCode,
          venueCode: m.venueCode,
          date: m.date,
          status: m.status,
          totalRaces: m.races?.length || 0,
        }))
        return json(200, formattedMeetings)
      } catch (e: any) {
        console.error("getActiveMeetings failed", { message: e?.message })
        return json(502, { error: "Failed to fetch meetings", detail: e?.message || "upstream error" })
      }
    }

    // ── /races ─────────────────────────────────────────────────────────────
    if (pathname === "/races") {
      try {
        const meetings = await horseAPI.getAllRaces()
        let allRaces: any[] = []
        if (meetings && meetings.length > 0) {
          meetings.forEach((meeting: any) => {
            if (meeting.races) {
              const meetingRaces = meeting.races.map((r: any) => ({
                id: r.id || `${meeting.venueCode}_${r.no}`,
                raceNumber: r.no,
                raceName: r.raceName_ch || r.raceName_en || `第 ${r.no} 場`,
                distance: r.distance,
                course: r.raceCourse?.description_ch || r.raceCourse?.description_en || "草地",
                raceClass: r.raceClass_ch || r.raceClass_en || "",
                runners: r.wageringFieldSize || r.runners?.length || 0,
                meetingId: meeting.id,
                venueCode: meeting.venueCode,
              }))
              allRaces = [...allRaces, ...meetingRaces]
            }
          })
        }
        return json(200, allRaces)
      } catch (e: any) {
        console.error("getAllRaces failed", { message: e?.message })
        return json(502, { error: "Failed to fetch races", detail: e?.message || "upstream error" })
      }
    }

    // ── /alerts ────────────────────────────────────────────────────────────
    if (pathname === "/alerts") {
      try {
        const urlParams = new URLSearchParams(event.queryStringParameters as any)
        const limit = Math.min(Number(urlParams.get("limit") ?? 30), 100)
        const severity = urlParams.get("severity") ?? undefined
        const date = urlParams.get("date") ?? undefined

        if (!process.env.DATABASE_URL) {
          return json(500, { error: "DATABASE_URL not configured" })
        }

        const sql = neon(process.env.DATABASE_URL)

        let historyQuery
        if (date && severity) {
          historyQuery = sql`SELECT * FROM alerts WHERE date = ${date}::date AND severity = ${severity} ORDER BY detected_at DESC LIMIT ${limit}`
        } else if (date) {
          historyQuery = sql`SELECT * FROM alerts WHERE date = ${date}::date ORDER BY detected_at DESC LIMIT ${limit}`
        } else if (severity) {
          historyQuery = sql`SELECT * FROM alerts WHERE severity = ${severity} ORDER BY detected_at DESC LIMIT ${limit}`
        } else {
          historyQuery = sql`SELECT * FROM alerts ORDER BY detected_at DESC LIMIT ${limit}`
        }

        const statsQuery = sql`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE severity = 'CRITICAL') as critical,
            COUNT(*) FILTER (WHERE severity = 'HIGH') as high,
            COUNT(*) FILTER (WHERE severity = 'MEDIUM') as medium
          FROM alerts
          WHERE date = CURRENT_DATE
        `

        const [history, statsResult] = await Promise.all([historyQuery, statsQuery])

        let stats = { critical: 0, high: 0, medium: 0, total: 0 }
        if (statsResult && statsResult.length > 0) {
          stats = {
            total: Number(statsResult[0].total),
            critical: Number(statsResult[0].critical),
            high: Number(statsResult[0].high),
            medium: Number(statsResult[0].medium),
          }
        }

        return json(200, { history, stats })
      } catch (e: any) {
        console.error("/alerts error", e)
        return json(500, { error: "Internal error", detail: e.message })
      }
    }

    // ── /predict/:venue/:raceNo ────────────────────────────────────────────
    const predictMatch = pathname.match(/^\/predict\/([^/]+)\/(\d+)/)
    if (predictMatch) {
      const venueCode = predictMatch[1]
      const raceNo = parseInt(predictMatch[2])
      const meetings = await horseAPI.getAllRaces()
      if (!meetings || meetings.length === 0) return json(404, { error: "No meetings found" })

      const meeting = meetings.find((m: any) => m.venueCode === venueCode)
      if (!meeting) return json(404, { error: `Meeting for venue ${venueCode} not found` })

      const race = meeting.races?.find((r: any) => {
        const rNo = parseInt(String(r.no), 10)
        return rNo === raceNo
      })

      if (!race) {
        const available = meeting.races?.map((r: any) => parseInt(String(r.no), 10)) ?? []
        return json(404, {
          error: `Race ${raceNo} not found in ${venueCode}`,
          availableRaces: available,
        })
      }

      // ── Step 1: WIN / PLA odds ─────────────────────────────────────────
      let oddsMap: Record<string, string> = {}
      let placeOddsMap: Record<string, string> = {}
      try {
        const oddsResponse: any = await hkjcClient.request(horseOddsQuery, {
          date: meeting.date,
          venueCode: meeting.venueCode,
          raceNo,
          oddsTypes: ["WIN", "PLA"],
        })
        const pools = oddsResponse.raceMeetings[0]?.pmPools || []
        const winPool = pools.find((p: any) => p.oddsType === "WIN")
        if (winPool?.oddsNodes) {
          winPool.oddsNodes.forEach((node: any) => {
            oddsMap[node.combString] = node.oddsValue
          })
        }
        const plaPool = pools.find((p: any) => p.oddsType === "PLA")
        if (plaPool?.oddsNodes) {
          plaPool.oddsNodes.forEach((node: any) => {
            placeOddsMap[node.combString] = node.oddsValue
          })
        }
      } catch { /* ignore */ }

      // ── Step 2: QIN odds (for per-horse aggregation) ───────────────────
      let qinOddsMap: Record<string, number> = {}
      let qplOddsMap: Record<string, number> = {}
      try {
        const qinOddsResponse: any = await hkjcClient.request(horseOddsQuery, {
          date: meeting.date,
          venueCode: meeting.venueCode,
          raceNo,
          oddsTypes: ["QIN", "QPL"],
        })
        const pools = qinOddsResponse.raceMeetings[0]?.pmPools || []

        const qinPool = pools.find((p: any) => p.oddsType === "QIN")
        if (qinPool?.oddsNodes) {
          qinPool.oddsNodes.forEach((node: any) => {
            const v = parseFloat(node.oddsValue)
            if (!isNaN(v) && v > 0) qinOddsMap[node.combString] = v
          })
        }

        const qplPool = pools.find((p: any) => p.oddsType === "QPL")
        if (qplPool?.oddsNodes) {
          qplPool.oddsNodes.forEach((node: any) => {
            const v = parseFloat(node.oddsValue)
            if (!isNaN(v) && v > 0) qplOddsMap[node.combString] = v
          })
        }
      } catch { /* ignore */ }

      // ── Step 3: Pool investment totals (horsePoolQuery) ────────────────
      let poolsData = { WIN: 0, PLA: 0, QIN: 0, QPL: 0, DBL: 0 }
      let isPreRace = true
      try {
        const poolResponse: any = await hkjcClient.request(horsePoolQuery, {
          date: meeting.date,
          venueCode: meeting.venueCode,
          raceNo,
          oddsTypes: ["WIN", "PLA", "QIN", "QPL"],
        })
        const poolInvs = poolResponse.raceMeetings[0]?.poolInvs || []
        const findPool = (type: string) => poolInvs.find((p: any) => p.oddsType === type)
        poolsData = {
          WIN: Number(findPool("WIN")?.investment || 0),
          PLA: Number(findPool("PLA")?.investment || 0),
          QIN: Number(findPool("QIN")?.investment || 0),
          QPL: Number(findPool("QPL")?.investment || 0),
          DBL: Number(findPool("DBL")?.investment || 0),
        }
        if (poolsData.WIN > 0 || poolsData.QIN > 0) isPreRace = false
      } catch { /* ignore */ }

      // ── Step 4: Historical odds and Race Results from Neon ─────────────
      let historicalOddsMap: Record<string, number> = {}
      let min30OddsMap: Record<string, number> = {}
      let resultsMap: Record<string, number> = {}
      if (process.env.DATABASE_URL) {
        try {
          const sql = neon(process.env.DATABASE_URL)
          const d = meeting.date.replace(/[\/-]/g, "")
          const isoDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
          const [min15Rows, min30Rows, resultRows] = await Promise.all([
            sql`
              SELECT runner_number, odds
              FROM odds_snapshots
              WHERE date = ${isoDate}
              AND venue = ${venueCode.toUpperCase()}
              AND race_no = ${raceNo}
              AND mtp_bucket = 15
              LIMIT 20
            `,
            sql`
              SELECT runner_number, odds
              FROM odds_snapshots
              WHERE date = ${isoDate}
              AND venue = ${venueCode.toUpperCase()}
              AND race_no = ${raceNo}
              AND mtp_bucket = 30
              LIMIT 20
            `,
            sql`
              SELECT runner_number, finish_pos
              FROM race_results
              WHERE date::date = ${isoDate}::date
              AND venue = ${venueCode.toUpperCase()}
              AND race_no = ${raceNo}
            `,
          ])
          min15Rows.forEach((row: any) => {
            const runnerNum = String(row.runner_number).padStart(2, "0")
            if (!historicalOddsMap[runnerNum]) historicalOddsMap[runnerNum] = parseFloat(row.odds)
          })
          min30Rows.forEach((row: any) => {
            const runnerNum = String(row.runner_number).padStart(2, "0")
            if (!min30OddsMap[runnerNum]) min30OddsMap[runnerNum] = parseFloat(row.odds)
          })
          resultRows.forEach((row: any) => {
            const runnerNum = String(row.runner_number).replace(/\D/g, "").padStart(2, "0")
            resultsMap[runnerNum] = parseInt(row.finish_pos)
          })
        } catch (e: any) {
          console.error("Neon fetch odds/results failed", e.message)
        }
      }

      // ── Build predictions ──────────────────────────────────────────────
      const runners: any[] = race.runners ?? []
      if (runners.length === 0) {
        return json(404, {
          error: `No runners found for Race ${raceNo} — field not yet declared`,
          raceNumber: raceNo,
          raceName: race.raceName_ch ?? race.raceName_en ?? `Race ${raceNo}`,
        })
      }

      const distance = parseInt(String(race.distance ?? "1200"), 10) || 1200
      const isSprint = distance <= 1200

      const goingStr = ((race.go_ch ?? "") + (race.go_en ?? "")).toUpperCase()
      const isWet = goingStr.includes("SOFT") || goingStr.includes("YIELDING")

      const groundKey = isWet ? "變化地" : "正常地"
      const raceTypeKey = isSprint ? "短途" : "中長途"
      const statCategory = `${raceTypeKey}${groundKey}`

      const classLimit = getRatingMax(race.raceClass_en || race.raceClass_ch || "4")
      const benchmark = getWeightRDBenchmark(distance)
      const dynamicWeights = getDynamicWeights(distance, race.raceClass_en || race.raceClass_ch || "4")

      const predictions: RunnerPrediction[] = runners.flatMap((r: any): RunnerPrediction[] => {
        try {
          const winOddsStr = r.winOdds || oddsMap[r.no.padStart(2, "0")] || oddsMap[r.no] || ""
          const hasOdds = winOddsStr !== ""
          const winOdds = hasOdds ? parseFloat(winOddsStr) : 99
          const weight = parseInt(r.handicapWeight as any) || 120
          const horseWeight = parseInt(r.currentWeight as any) || 1100
          const currentRating = parseInt(r.currentRating as any) || 0

          const last3Form = r.last6run
            ? r.last6run.split(/[/\- ]/).slice(0, 3).join("/")
            : "—"

          const horseCode = r.horse?.code || ""
          const age = estimateAge(horseCode)

          let weightRange = "120-124"
          if (weight >= 130) weightRange = "130+"
          else if (weight >= 125) weightRange = "125-129"
          else if (weight < 120) weightRange = "<119"

          const statWinRate = STAT_WIN_RATES[statCategory]?.[weightRange] || 40
          const statScore = statWinRate / 100

          const weightRD = (weight / horseWeight) * distance
          const burdenScore = Math.max(0, (benchmark - weightRD) / benchmark)

          let ageBonus = 1.0
          let ageStage: "risingstar" | "primewarrior" | "veteran" | "unknown" = "veteran"
          let ageStageLabel = ""
          if (age <= 3) {
            ageBonus = AGE_FACTORS["2-3歲"]
            ageStage = "risingstar"
            ageStageLabel = "潛力新星"
          } else if (age <= 5) {
            ageBonus = AGE_FACTORS["4-5歲"]
            ageStage = "primewarrior"
            ageStageLabel = "巔峰戰將"
          } else {
            ageBonus = AGE_FACTORS["6-10歲"]
            ageStage = "veteran"
            ageStageLabel = "沙場老將"
          }

          let c = 0.055
          if (distance >= 2200) c = 0.22
          else if (distance >= 1800) c = 0.16
          else if (distance >= 1400) c = 0.11

          const deltaW = weight - 120
          const deltaTBase = (deltaW / 2) * c

          let fGround = 1.0
          if (goingStr.includes("大爛地") || goingStr.includes("爛") || goingStr.includes("HEAVY")) {
            fGround = 1.30
          } else if (
            goingStr.includes("軟") ||
            goingStr.includes("SOFT") ||
            goingStr.includes("YIELDING") ||
            goingStr.includes("黏")
          ) {
            fGround = 1.15
          } else if (goingStr === "好地" || (goingStr.includes("GOOD") && !goingStr.includes("FIRM"))) {
            fGround = 1.05
          } else if (
            goingStr.includes("好至快") ||
            (goingStr.includes("好") && goingStr.includes("快")) ||
            goingStr.includes("GOOD TO FIRM") ||
            goingStr.includes("GOOD/FIRM") ||
            goingStr.includes("FIRM")
          ) {
            fGround = 1.00
          }

          let fStyle = 1.0
          const runNums = (r.last6run ?? "").split(/[/\- ]/).map(Number).filter((n: number) => !isNaN(n) && n > 0)
          if (runNums.includes(1) || runNums.includes(2)) {
            fStyle = 0.95
          } else if (runNums.some((n: number) => n >= 9)) {
            fStyle = distance >= 1400 ? 1.10 : 1.05
          }

          const timeAdvantage = deltaTBase * fGround * fStyle
          const ratingScore = Math.min(1.0, currentRating / classLimit)
          const timeScore = Math.max(0, Math.min(1.0, 0.5 - timeAdvantage))

          const conditionMult = getConditionMult(last3Form)
          let conditionLabel = ""
          if (conditionMult >= 1.1) conditionLabel = "上升中"
          else if (conditionMult >= 1.0) conditionLabel = "狀態穩"
          else if (conditionMult <= 0.8) conditionLabel = "狀態差"
          else conditionLabel = "略降"

          const { wStat, wBurden, wRating, wAge, wTime } = dynamicWeights
          const rawScore =
            (statScore * wStat +
              burdenScore * wBurden +
              ratingScore * wRating +
              ageBonus * wAge +
              timeScore * wTime) *
            100
          const score = Math.round(rawScore * conditionMult)

          const marketImpliedProb = hasOdds ? 1 / (winOdds + 1) : 1 / 99

          let grade: "A" | "B" | "C" | "D" = "D"
          if (rawScore >= 80) grade = "A"
          else if (rawScore >= 60) grade = "B"
          else if (rawScore >= 40) grade = "C"

          const riskFactors: string[] = []
          if (weight > 130) riskFactors.push("負磅過重(>130)")
          if (conditionMult < 0.9) riskFactors.push("狀態下滑")
          if (weight / horseWeight > 0.13) riskFactors.push("負磅體重比異常(>13%)")
          if (age >= 8 && conditionMult < 1.0) riskFactors.push("老齡退化")

          const displayOdds = hasOdds ? winOdds : "—"
          const placeOddsStr = placeOddsMap[r.no.padStart(2, "0")] || placeOddsMap[r.no] || ""
          const placeOdds = placeOddsStr ? parseFloat(placeOddsStr) : "—"

          const weightRatio = (weight / horseWeight) * 100
          const weightD = weight * distance

          let displayRunnerNumber: string | number = parseInt(r.no)
          if (
            !r.no ||
            isNaN(displayRunnerNumber as number) ||
            String(r.no).toLowerCase().includes("standby") ||
            String(r.no).includes("後備")
          ) {
            const match = String(r.no || "").match(/\d+/)
            displayRunnerNumber = match ? `R${match[0]}` : "R"
          }

          // ── Odds history ──────────────────────────────────────────────────
          const oddsHistory: any = { overnight: null, min30: null, min15: null, current: displayOdds }
          const runnerKey = String(displayRunnerNumber).replace(/\D/g, "").padStart(2, "0")
          if (historicalOddsMap[runnerKey]) oddsHistory.min15 = historicalOddsMap[runnerKey]
          if (min30OddsMap[runnerKey]) oddsHistory.min30 = min30OddsMap[runnerKey]

          // Fallback: deterministic drift when no Neon data yet
          if (!oddsHistory.min15 && displayOdds !== "—") {
            const oddsNum = parseFloat(String(displayOdds))
            if (!isNaN(oddsNum)) {
              const num =
                typeof displayRunnerNumber === "string"
                  ? parseInt(displayRunnerNumber.replace(/\D/g, "")) || 0
                  : displayRunnerNumber
              const drift = ((num as number) % 11 - 5) / 100
              oddsHistory.min15 = parseFloat((oddsNum * (1 - drift)).toFixed(1))
            }
          }

          // ── Pool reverse-engineering (pre-race uses 28M/20M estimate) ─────
          const DEDUCT = 0.825
          const WIN_BASE = poolsData.WIN || 28_000_000
          const QIN_BASE = poolsData.QIN || 20_000_000
          const QPL_BASE = poolsData.QPL || 15_000_000

          const estWinInvestment =
            hasOdds && winOdds > 0
              ? Math.round((WIN_BASE * DEDUCT) / winOdds)
              : null

          const rNo = String(r.no).padStart(2, "0")

          // Aggregate QIN Investment
          let qinSum = 0
          Object.entries(qinOddsMap).forEach(([combo, odds]) => {
            if (odds > 0 && QIN_BASE > 0) {
              const parts = combo.split(",").map((x: string) => x.padStart(2, "0"))
              if (parts.includes(rNo)) qinSum += (QIN_BASE * DEDUCT) / odds
            }
          })
          const estQINInvestment = qinSum > 0 ? Math.round(qinSum) : null

          // Aggregate QPL Investment
          let qplSum = 0
          Object.entries(qplOddsMap).forEach(([combo, odds]) => {
            if (odds > 0 && QPL_BASE > 0) {
              const parts = combo.split(",").map((x: string) => x.padStart(2, "0"))
              if (parts.includes(rNo)) qplSum += (QPL_BASE * DEDUCT) / odds
            }
          })
          const estQPLInvestment = qplSum > 0 ? Math.round(qplSum) : null

          let moneyAlert: "large_bet" | "drifting" | null = null
          if (oddsHistory.min30 && !isNaN(parseFloat(r.winOdds))) {
            const prev = oddsHistory.min30
            const curr = parseFloat(r.winOdds)
            // 賠率下跌 ≥ 20% 觸發大戶落飛警報
            if (curr <= prev * 0.8) moneyAlert = "large_bet"
            else if (curr >= prev * 1.2) moneyAlert = "drifting"
          }

          const finalPosition = resultsMap[runnerKey] || null

          return [{
            runnerNumber: displayRunnerNumber,
            runnerName: r.name_ch || r.name_en,
            jockey: r.jockey?.name_ch || r.jockey?.name_en || "未知",
            trainer: r.trainer?.name_ch || r.trainer?.name_en || "未知",
            draw: parseInt(r.barrierDrawNumber) || 0,
            weight,
            winProbability: 0,
            placeProb: Math.round(score * 0.7),
            winOdds: displayOdds,
            placeOdds,
            score,
            grade,
            rating: currentRating,
            horseWeight,
            last3Form,
            investmentLabel: "NONE",
            riskFactors,
            weightD,
            weightRatio: parseFloat(weightRatio.toFixed(2)),
            weightRD: parseFloat(weightRD.toFixed(2)),
            timeAdvantage: parseFloat(timeAdvantage.toFixed(3)),
            statRate: parseFloat(statWinRate.toFixed(1)),
            statScore: parseFloat((statScore * 100).toFixed(1)),
            ratingScore: parseFloat((ratingScore * 100).toFixed(1)),
            age,
            ageStage,
            ageStageLabel,
            ageBonus,
            conditionLabel,
            conditionMultiplier: conditionMult,
            marketImpliedProb: parseFloat(marketImpliedProb.toFixed(4)),
            winProbModel: 0,
            modelOdds: 0,
            diffProb: 0,
            expectedValue: 0,
            kellyFraction: 0,
            analysis: `【${grade}級】綜合評分 ${(score / 100).toFixed(2)} (A:0.8+, B:0.6+)。${
              timeAdvantage < 0
                ? `具備 ${Math.abs(timeAdvantage).toFixed(3)}s 時間優勢`
                : timeAdvantage > 0
                ? `存在 ${timeAdvantage.toFixed(3)}s 時間劣勢`
                : `時間差 0.000s`
            }。累積負擔(WeightRD) ${weightRD.toFixed(1)}，標準區間(${benchmark.toFixed(1)})。`,
            oddsHistory,
            estWinInvestment,
            estQINInvestment,
            estQPLInvestment,
            moneyAlert,
            isTheoretical: isPreRace,
            finalPosition,
          }]
        } catch (runnerErr: any) {
          console.error(`Runner ${r?.no} parse error:`, runnerErr?.message)
          return [{
            runnerNumber: r?.no ?? "?",
            runnerName: r?.name_ch ?? r?.name_en ?? `Runner ${r?.no}`,
            jockey: r?.jockey?.name_ch ?? r?.jockey?.name_en ?? "—",
            trainer: r?.trainer?.name_ch ?? r?.trainer?.name_en ?? "—",
            draw: 0,
            weight: 120,
            winProbability: 0,
            placeProb: 0,
            winOdds: "—",
            placeOdds: "—",
            score: 0,
            grade: "D" as "D",
            rating: 0,
            horseWeight: 1000,
            last3Form: "—",
            investmentLabel: "NONE",
            riskFactors: ["Error"],
            weightD: 0,
            weightRatio: 0,
            weightRD: 0,
            timeAdvantage: 0,
            statRate: 0,
            statScore: 0,
            ratingScore: 0,
            age: 5,
            ageStage: "unknown",
            ageStageLabel: "未知",
            ageBonus: 1,
            conditionLabel: "未知",
            conditionMultiplier: 1,
            marketImpliedProb: 0,
            winProbModel: 0,
            modelOdds: 0,
            diffProb: 0,
            expectedValue: 0,
            kellyFraction: 0,
            analysis: "解析錯誤",
            oddsHistory: { overnight: null, min30: null, min15: null, current: "—" },
            estWinInvestment: null,
            estQINInvestment: null,
            estQPLInvestment: null,
            moneyAlert: null,
            isTheoretical: true,
            finalPosition: null,
          }]
        }
      })

      // ── Softmax win probability ────────────────────────────────────────
      const expScores = predictions.map((p: any) => Math.exp(p.score / 20))
      const totalExp = expScores.reduce((a: number, b: number) => a + b, 0)

      predictions.forEach((p: any, idx: number) => {
        p.winProbModel = parseFloat((expScores[idx] / totalExp).toFixed(4))
        p.winProbability = Math.round(p.winProbModel * 100)
        p.modelOdds = parseFloat((1 / p.winProbModel - 1).toFixed(1))
        p.diffProb = parseFloat((p.winProbModel - p.marketImpliedProb).toFixed(4))

        if (p.winOdds !== "—") {
          const winOddsNum = parseFloat(p.winOdds as string)
          p.expectedValue = parseFloat((p.winProbModel * winOddsNum - 1).toFixed(2))
          if (winOddsNum > 1) {
            const kelly = p.expectedValue / (winOddsNum - 1)
            p.kellyFraction = parseFloat((Math.max(0, kelly) * 100).toFixed(1))
          }
        }

        // ── Combat advice ──────────────────────────────────────────────
        const ev = p.expectedValue
        let advice = ""
        let combatStatus: "AVOID" | "SHADOW" | "CAUTION" | "GO" = "AVOID"
        const tieBreakerNotes: string[] = []

        if (p.weightRD < benchmark * 0.97) tieBreakerNotes.push("WeightRD優勢")
        const timeThreshold =
          (distance || 1200) <= 1200
            ? -0.1
            : (distance || 1200) <= 1650
            ? -0.2
            : (distance || 1200) <= 2000
            ? -0.3
            : -0.4
        if (p.timeAdvantage < timeThreshold) tieBreakerNotes.push("時間差優勢")
        if (p.ageBonus >= 1.0 && p.ageBonus < 1.05) tieBreakerNotes.push("巔峰戰將")

        const oddsDropping =
          p.oddsHistory.current != null &&
          p.oddsHistory.current !== "—" &&
          p.oddsHistory.min15 != null &&
          p.oddsHistory.min15 !== "—" &&
          parseFloat(String(p.oddsHistory.current)) < parseFloat(String(p.oddsHistory.min15))
        if (oddsDropping) tieBreakerNotes.push("賠率下跌(市場資金流入)")

        const tb = tieBreakerNotes.length > 0 ? ` (+${tieBreakerNotes.join(", ")})` : ""

        if (ev >= -0.06) {
          advice = `積極投注 ⭐⭐⭐ (EV ≥ -6%)${tb}`
          combatStatus = "GO"
        } else if (ev < -0.06 && ev >= -0.15) {
          advice = `試注或Q位配腳 ⚠️ (EV -6% ~ -15%)${tb}`
          combatStatus = "CAUTION"
        } else if (ev < -0.15 && ev >= -0.30) {
          advice = `⚡市場偏好 Q位關注 (EV -15% ~ -30%)${tb}`
          combatStatus = "SHADOW"
        } else {
          advice = `避免投注 ✗ (EV < -30%)${tb}`
          combatStatus = "AVOID"
        }

        p.combatAdvice = advice
        p.combatStatus = combatStatus

        if (p.grade === "A") p.investmentLabel = "BEST"
        else if (p.grade === "B") p.investmentLabel = "STABLE"
        else if (p.expectedValue > 0 && p.weight <= 118 && p.weightRD < benchmark)
          p.investmentLabel = "DARKHORSE"

        if (p.riskFactors.length > 0 && p.investmentLabel !== "BEST") p.investmentLabel = "RISK"
      })

      predictions.sort((a: any, b: any) => {
        if (a.modelOdds !== b.modelOdds) return a.modelOdds - b.modelOdds
        if (a.winProbModel !== b.winProbModel) return b.winProbModel - a.winProbModel
        return a.runnerNumber - b.runnerNumber
      })

      // ── Odds structure classification ──────────────────────────────────
      const oddsStructure = analyzeOddsStructure(predictions, isPreRace)

      const validPredictions = predictions.filter((p: any) => !String(p.runnerNumber).startsWith("R"))
      let topPick = validPredictions.length > 0 ? validPredictions[0] : predictions[0]
      let summaryTextBase = `AI 四維度分析（按模型賠率排名）：首選 #${topPick.runnerNumber} ${topPick.runnerName}（模型賠率 ${topPick.modelOdds}）。`

      // ══════════════════════════════════════════════════════════════════════
      // 混亂局 AI 首選邏輯：從半冷馬(od2: 10~19.9)中，找 QIN/WIN 柱體比例最高者
      //
      // FIX 1: 使用有意義的異常門檻，pre-race 估算場景門檻更高
      // FIX 2: 使用 Map 儲存比例，不污染原始 prediction 物件
      // FIX 3: 無足夠異常信號時，仍在 summaryText 標示賽局類型
      // ══════════════════════════════════════════════════════════════════════
      if (oddsStructure.raceTypeCode === "CHAOTIC") {
        // pre-race 時兩個投注池都用估算基數，QIN 因組合數多天然偏高，門檻須更嚴格
        const CHAOTIC_QIN_THRESHOLD = isPreRace ? 3.0 : 1.5

        const od2Runners = validPredictions.filter((p: any) => {
          if (p.winOdds === "—") return false
          const odds = parseFloat(String(p.winOdds))
          return odds >= 10 && odds < 20
        })

        if (od2Runners.length > 0) {
          // 用 Map 儲存比例，避免污染 prediction 物件回傳給前端
          const qinRatioMap = new Map<any, number>()
          od2Runners.forEach((p: any) => {
            const winInv = p.estWinInvestment || 0
            const qinInv = p.estQINInvestment || 0
            qinRatioMap.set(p, winInv > 0 ? qinInv / winInv : 0)
          })

          od2Runners.sort((a: any, b: any) => (qinRatioMap.get(b) ?? 0) - (qinRatioMap.get(a) ?? 0))

          const bestOd2 = od2Runners[0]
          const bestRatio = qinRatioMap.get(bestOd2) ?? 0

          console.log(`[CHAOTIC] isPreRace=${isPreRace} threshold=${CHAOTIC_QIN_THRESHOLD} bestOd2=#${bestOd2.runnerNumber} ratio=${bestRatio.toFixed(2)}`)

          if (bestRatio >= CHAOTIC_QIN_THRESHOLD) {
            topPick = bestOd2
            summaryTextBase = `【混亂局特選】AI 偵測到半冷馬異常資金：首選 #${topPick.runnerNumber} ${topPick.runnerName}（賠率 ${topPick.winOdds}，QIN 柱體異常比例 ${bestRatio.toFixed(1)}x）。`
          } else {
            // 信號不足，維持模型首選但提示賽局類型
            summaryTextBase = `【混亂局】半冷馬資金信號不足（最高比例 ${bestRatio.toFixed(1)}x，未達門檻 ${CHAOTIC_QIN_THRESHOLD}x）。` + summaryTextBase
          }
        } else {
          // 無 od2 馬（全場無10-19.9賠率馬），仍標示賽局類型
          summaryTextBase = `【混亂局】本場無半冷馬(od2)可供分析，維持模型首選。` + summaryTextBase
        }
      }

      const hasDarkHorse = validPredictions.some((p: any) => p.investmentLabel === "DARKHORSE")
      const highRiskRunners = validPredictions.filter((p: any) => p.investmentLabel === "RISK").length

      const summaryText = `${summaryTextBase}${
        hasDarkHorse ? "本場存在潛在黑馬，" : ""
      }${highRiskRunners > 0 ? `有 ${highRiskRunners} 匹高風險賽駒需警惕。` : "全場狀態相對穩定。"}`

      const raceDetail = {
        id: race.id,
        raceNumber: race.no,
        raceName: race.raceName_ch || race.raceName_en || `第 ${race.no} 場`,
        distance: race.distance,
        distanceMeters: distance,
        benchmarkRD: benchmark,
        course: race.raceCourse?.description_ch || race.raceCourse?.description_en || "草地",
        raceClass: race.raceClass_ch || race.raceClass_en || "",
        runners: race.wageringFieldSize || runners.length,
        totalRaces: (meeting as any).totalRaces || meeting.races?.length || 11,
        meetingId: meeting.id || "current",
        venueCode,
        date: meeting.date,
        track: race.raceTrack?.description_ch || race.raceTrack?.description_en || "草地",
        going: race.go_ch || race.go_en || "好地",
        postTime: race.postTime,
        meetingType: meeting.meetingType === "N" ? "夜賽" : "日賽",
        topPick,
        predictions,
        pools: isPreRace ? null : poolsData,
        oddsStructure,
        isPreRace,
        summary: summaryText,
        aiSummary: summaryText,
        confidence:
          topPick.winProbModel >= 0.18 ? "HIGH" : topPick.winProbModel >= 0.1 ? "MEDIUM" : "LOW",
      }

      return json(200, raceDetail)
    }

    // ── /push-subscribe ────────────────────────────────────────────────────
    if (pathname === "/push-subscribe") {
      if (method === "POST") {
        if (!process.env.DATABASE_URL) return json(500, { error: "DATABASE_URL not configured" })
        try {
          const subscription = JSON.parse(event.body || "{}")
          if (!subscription.endpoint) return json(400, { error: "Invalid subscription: missing endpoint" })
          const sql = neon(process.env.DATABASE_URL)
          await sql`
            INSERT INTO push_subscriptions (endpoint, auth, p256dh, created_at)
            VALUES (${subscription.endpoint}, ${subscription.keys?.auth || null}, ${subscription.keys?.p256dh || null}, NOW())
            ON CONFLICT (endpoint) DO UPDATE SET auth = EXCLUDED.auth, p256dh = EXCLUDED.p256dh, updated_at = NOW()
          `
          return json(201, { success: true })
        } catch (e: any) {
          return json(500, { error: "Failed to save subscription", detail: e.message })
        }
      } else if (method === "DELETE") {
        if (!process.env.DATABASE_URL) return json(500, { error: "DATABASE_URL not configured" })
        try {
          const { endpoint } = JSON.parse(event.body || "{}")
          if (!endpoint) return json(400, { error: "Missing endpoint" })
          const sql = neon(process.env.DATABASE_URL)
          await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`
          return json(200, { success: true })
        } catch (e: any) {
          return json(500, { error: "Failed to delete subscription", detail: e.message })
        }
      }
      return json(405, { error: "Method not allowed" })
    }

    // ── /push-send ─────────────────────────────────────────────────────────
    if (pathname === "/push-send" && method === "POST") {
      const authHeader = event.headers.authorization
      const expectedToken = `Bearer ${process.env.CRON_SECRET}`

      if (!process.env.CRON_SECRET || authHeader !== expectedToken) {
        return json(401, { error: "Unauthorized" })
      }

      if (!process.env.DATABASE_URL) return json(500, { error: "DATABASE_URL not configured" })

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""
      const privateKey = process.env.VAPID_PRIVATE_KEY || ""
      const subject = process.env.VAPID_SUBJECT || "mailto:admin@masterjoe.app"
      if (!publicKey || !privateKey) return json(500, { error: "VAPID keys not configured" })

      try {
        const webpush = (await import("web-push")).default
        webpush.setVapidDetails(subject, publicKey, privateKey)

        const payload = JSON.parse(event.body || "{}")
        const notificationPayload = JSON.stringify({
          title: payload.title || "馬靈靈 新警報",
          body: payload.body || "有新的異常資金警報！",
          url: payload.url || "/",
          icon: payload.icon || "/icons/icon-192x192.png",
          tag: payload.tag || "alert",
          vibrate: payload.vibrate || [200, 100, 200],
        })

        const sql = neon(process.env.DATABASE_URL)
        const subscriptions = await sql`SELECT * FROM push_subscriptions`

        if (subscriptions.length === 0) return json(200, { success: true, message: "No active subscriptions" })

        const sendPromises = subscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
              notificationPayload
            )
            return { success: true, endpoint: sub.endpoint }
          } catch (err: any) {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`
            }
            return { success: false, endpoint: sub.endpoint, error: err.message }
          }
        })

        const results = await Promise.all(sendPromises)
        return json(200, {
          success: true,
          sent: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          results,
        })
      } catch (e: any) {
        return json(500, { error: "Internal server error", detail: e.message })
      }
    }

    return json(404, { error: "Not found" })
  } catch (e: any) {
    return json(500, { error: e?.message || "Internal error" })
  }
}
