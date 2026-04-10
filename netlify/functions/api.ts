import type { Handler } from "@netlify/functions"
import { HorseRacingAPI, HKJCClient } from "hkjc-api"
import { horseOddsQuery, horsePoolQuery } from "hkjc-api/dist/query/horseRacingQuery.js"
import { neon } from "@neondatabase/serverless"

const horseAPI = new HorseRacingAPI()
const hkjcClient = new HKJCClient()

const STAT_WIN_RATES: Record<string, Record<string, number>> = {
  çŸ­é€”æ­£å¸¸åœ°: { "<119": 50.0, "120-124": 57.8, "125-129": 25.0, "130+": 57.1 },
  çŸ­é€”è®ŠåŒ–åœ°: { "<119": 27.27, "120-124": 48.0, "125-129": 46.67, "130+": 57.14 },
  ä¸­é•·é€”æ­£å¸¸åœ°: { "<119": 37.5, "120-124": 46.2, "125-129": 54.5, "130+": 60.0 },
  ä¸­é•·é€”è®ŠåŒ–åœ°: { "<119": 37.5, "120-124": 36.11, "125-129": 40.54, "130+": 37.5 },
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
  "2-3æ­²": 0.8,
  "4-5æ­²": 1.0,
  "6-10æ­²": 0.9,
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


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ODDS STRUCTURE ANALYSIS â€” based on Chinese racing analytics methodology
// Classifies each race into é¦¬è†½å±€ / åˆ†ç«‹å±€ / æ··äº‚å±€ using favorite odds tiers
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

interface OddsStructureResult {
  raceType: "é¦¬è†½å±€" | "åˆ†ç«‹å±€" | "æ··äº‚å±€" | "æœªèƒ½åˆ¤æ–·"
  raceTypeCode: "BANKER" | "SPLIT" | "CHAOTIC" | "UNKNOWN"
  od1: number          // favorite odds
  od2: number          // 2nd favorite odds
  od3: number          // 3rd favorite odds
  od4: number          // 4th favorite odds
  hotCount: number     // horses with winOdds â‰¤ 10
  coldSignal: boolean  // true = likely cold race result
  qinFocus: "od1_group" | "od2_od3_group" | "spread" | "unknown"
  topBanker: string | null   // runnerNumber of banker (if é¦¬è†½å±€)
  coldCandidates: (string | number)[]  // runner numbers worth watching for cold
  description: string
  tip: string
}

function analyzeOddsStructure(
  predictions: any[],
  isPreRace: boolean
): OddsStructureResult {
  const NA: OddsStructureResult = {
    raceType: "æœªèƒ½åˆ¤æ–·", raceTypeCode: "UNKNOWN",
    od1: 0, od2: 0, od3: 0, od4: 0,
    hotCount: 0, coldSignal: false,
    qinFocus: "unknown", topBanker: null, coldCandidates: [],
    description: isPreRace ? "è³ çŽ‡æœªé–‹ç›¤ï¼Œæš«ç„¡æ³•åˆ¤æ–·è³½å±€çµæ§‹ã€‚" : "è³½é§’ä¸è¶³ï¼Œç„¡æ³•åˆ¤æ–·è³½å±€çµæ§‹ã€‚",
    tip: "ç­‰å¾…è³ çŽ‡é–‹ç›¤å¾Œåˆ†æžã€‚",
  }

  const withOdds = predictions
    .filter(
      (p) =>
        p.winOdds !== "â€”" &&
        !isNaN(parseFloat(String(p.winOdds))) &&
        !String(p.runnerNumber).startsWith("R")
    )
    .sort((a, b) => parseFloat(String(a.winOdds)) - parseFloat(String(b.winOdds)))

  if (withOdds.length < 4) return NA

  const od1 = parseFloat(String(withOdds[0].winOdds))
  const od2 = parseFloat(String(withOdds[1].winOdds))
  const od3 = parseFloat(String(withOdds[2].winOdds))
  const od4 = withOdds[3] ? parseFloat(String(withOdds[3].winOdds)) : 99

  const hotCount = withOdds.filter((p) => parseFloat(String(p.winOdds)) <= 10).length

  // Candidate cold horses = those ranked 3rdâ€“6th by odds (od3 ~ od6 range)
  const coldCandidates = withOdds
    .slice(2, 6)
    .filter((p) => parseFloat(String(p.winOdds)) >= 6)
    .map((p) => p.runnerNumber)

  const topBanker = withOdds[0].runnerNumber

  // â”€â”€ Rule 1: é¦¬è†½å±€ â”€â”€ od1 â‰¤ 3 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (od1 <= 3) {
    let tip = `å¼·é¦¬è†½ #${topBanker}ï¼ˆ${od1}ï¼‰å­˜åœ¨ã€‚é€£è´(Q)èšç„¦é¦–é¸é…æ­æ¬¡é¸ã€‚`
    let qin: OddsStructureResult["qinFocus"] = "od1_group"

    // Special: od1 < 3 AND od2 >= 4 â†’ banker dominates, Q almost certainly includes od1
    if (od2 >= 4) {
      tip = `è¶…å¼·é¦¬è†½ #${topBanker}ï¼ˆ${od1}ï¼‰é…æ­æ¬¡é¸ï¼ˆ${od2}ï¼‰ã€‚Qå¹¾ä¹Žç¢ºå®šåŒ…å«é¦–é¸ï¼Œå®œä»¥é¦–é¸ç‚ºè†½é€£æŽ¥3è‡³4åŒ¹è…³ã€‚`
    }

    return {
      raceType: "é¦¬è†½å±€", raceTypeCode: "BANKER",
      od1, od2, od3, od4, hotCount,
      coldSignal: false,
      qinFocus: qin,
      topBanker: String(topBanker),
      coldCandidates: [],
      description: `é¦¬è†½å±€ï¼šè¶…ç­é¦¬è†½å­˜åœ¨ï¼ˆé¦–é¸è³ çŽ‡ ${od1}ï¼‰ï¼Œç†±é–€é›†ä¸­ï¼Œè³½æžœåå‘ç†±é–€ä¸»å°Žã€‚`,
      tip,
    }
  }

  // â”€â”€ Rule 3: æ··äº‚å±€ â”€â”€ od1 â‰ˆ 4ï¼ˆ3.5 ~ 5.5ï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (od1 >= 3.5 && od1 <= 5.5) {
    const subColdSignal = od2 >= 4 // both od1 & od2 high â†’ even more chaotic
    return {
      raceType: "æ··äº‚å±€", raceTypeCode: "CHAOTIC",
      od1, od2, od3, od4, hotCount,
      coldSignal: true,
      qinFocus: "od2_od3_group",
      topBanker: null,
      coldCandidates,
      description: `æ··äº‚å±€ï¼šé¦–é¸è³ çŽ‡ç´„4ï¼ˆ${od1}ï¼‰${subColdSignal ? `ï¼Œæ¬¡é¸åŒæ¨£åé«˜ï¼ˆ${od2}ï¼‰` : ""}ã€‚Qå…¨åœ¨é¦–é¸å‡ºç¾æ©ŸçŽ‡åä½Žï¼Œå†·è³½æžœä¿¡è™Ÿå¼·çƒˆã€‚`,
      tip: `âš ï¸ å†·è³½æžœé«˜å±å ´ï¼šèªçœŸæ¯”è¼ƒæ¬¡é¸ï¼ˆ${od2}ï¼‰è‡³ç¬¬å››é¸ï¼ˆ${od4}ï¼‰ä¸­çš„å†·é¦¬ï¼Œç‰¹åˆ¥ç•™æ„å¹´è¼•è³ªæ–°é¦¬ã€é…ä»¶æ”¹è®Šé¦¬ã€è½‰é¦¬æˆ¿é¦¬ã€‚`,
    }
  }

  // â”€â”€ Rule 2: åˆ†ç«‹å±€ â”€â”€ od1 > 5.5 OR (od2 â‰¥ 4 with stratification) â”€â”€â”€â”€â”€â”€â”€â”€
  if (od2 >= 4) {
    const bothHigh = od1 >= 4 && od2 >= 4
    const coldSignal = bothHigh
    const qin: OddsStructureResult["qinFocus"] = bothHigh ? "spread" : "od1_group"
    const desc = bothHigh
      ? `åˆ†ç«‹å±€ï¼ˆæ··äº‚å‚¾å‘ï¼‰ï¼šé¦–é¸ï¼ˆ${od1}ï¼‰èˆ‡æ¬¡é¸ï¼ˆ${od2}ï¼‰è³ çŽ‡å·®ç•°ä¸å¤§ï¼Œod1åˆ†å±¤è¢«od2ç“¦è§£ï¼Œæ•´é«”å±€é¢ä»æ··äº‚ï¼Œå†·é¦¬æ©ŸçŽ‡ä¸Šå‡ã€‚`
      : `åˆ†ç«‹å±€ï¼šç†±é–€å­˜åœ¨ä¸€å®šåˆ†å±¤ï¼ˆé¦–é¸ ${od1}ï¼Œæ¬¡é¸ ${od2}ï¼‰ï¼ŒQæœ‰è¼ƒé«˜æ¦‚çŽ‡åœ¨é¦–é¸çµ„åˆ¥ä¸­å‡ºç¾ã€‚`
    const tip = bothHigh
      ? `od1èˆ‡od2å‡â‰¥4ï¼Œå†·é¦¬çµæžœæ©ŸçŽ‡é«˜ã€‚å¯è€ƒæ…®åœ¨od3ï¼ˆ${od3}ï¼‰é™„è¿‘å°‹æ‰¾å†·é¦¬é…æ­ã€‚`
      : `Qèšç„¦é¦–é¸#${topBanker}é…æ­2è‡³3åŒ¹æ¬¡é¸ï¼Œç†±é–€ç«¶çˆ­å¤šï¼Œæ³¨ç¢¼å®œåˆ†æ•£ã€‚`
    return {
      raceType: "åˆ†ç«‹å±€", raceTypeCode: "SPLIT",
      od1, od2, od3, od4, hotCount,
      coldSignal,
      qinFocus: qin,
      topBanker: coldSignal ? null : String(topBanker),
      coldCandidates: coldSignal ? coldCandidates : [],
      description: desc,
      tip,
    }
  }

  // Fallback: od1 > 5, od2 < 4 â€” still a split but moderate
  return {
    raceType: "åˆ†ç«‹å±€", raceTypeCode: "SPLIT",
    od1, od2, od3, od4, hotCount,
    coldSignal: false,
    qinFocus: "od1_group",
    topBanker: String(topBanker),
    coldCandidates: [],
    description: `åˆ†ç«‹å±€ï¼šç†±é–€ç«¶çˆ­é©ä¸­ï¼ˆé¦–é¸ ${od1}ï¼Œæ¬¡é¸ ${od2}ï¼‰ï¼Œç†±é–€ç›¸çˆ­æ•¸é‡ ${hotCount} åŒ¹ã€‚`,
    tip: `Qä»¥é¦–é¸#${topBanker}ç‚ºä¸»è»¸ï¼Œé…æ­2è‡³3åŒ¹æ¬¡é¸ï¼Œæ³¨æ„ç†±é–€è¼ƒå¤šæ™‚æ´¾å½©åä½Žï¼Œå­å½ˆå®œç¯€çœã€‚`,
  }
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

export const handler: Handler = async (event) => {
  try {
    const rawPath = event.path || ""
    const pathname = rawPath
      .replace(/^\/\.netlify\/functions\/api/, "")
      .replace(/^\/api/, "")
    const method = event.httpMethod || "GET"
    console.log("API request", { method, rawPath, pathname })

    if (method !== "GET") return json(405, { error: "Method not allowed" })

    // â”€â”€ /meetings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (pathname === "/meetings") {
      try {
        const meetings = await horseAPI.getActiveMeetings()
        const formattedMeetings = meetings.map((m: any) => ({
          id: m.id,
          venue: m.venueCode === "HV" ? "è·‘é¦¬åœ°" : m.venueCode === "ST" ? "æ²™ç”°" : m.venueCode,
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

    // â”€â”€ /races â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                raceName: r.raceName_ch || r.raceName_en || `ç¬¬ ${r.no} å ´`,
                distance: r.distance,
                course: r.raceCourse?.description_ch || r.raceCourse?.description_en || "è‰åœ°",
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

    // â”€â”€ /predict/:venue/:raceNo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ Step 1: WIN / PLA odds â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ Step 2: QIN odds (for per-horse aggregation) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let qinOddsMap: Record<string, number> = {}
      try {
        const qinOddsResponse: any = await hkjcClient.request(horseOddsQuery, {
          date: meeting.date,
          venueCode: meeting.venueCode,
          raceNo,
          oddsTypes: ["QIN"],
        })
        const qinPool = (qinOddsResponse.raceMeetings[0]?.pmPools || []).find(
          (p: any) => p.oddsType === "QIN"
        )
        if (qinPool?.oddsNodes) {
          qinPool.oddsNodes.forEach((node: any) => {
            const v = parseFloat(node.oddsValue)
            if (!isNaN(v) && v > 0) qinOddsMap[node.combString] = v
          })
        }
      } catch { /* ignore */ }

      // â”€â”€ Step 3: Pool investment totals (horsePoolQuery) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ Step 4: Historical odds from Neon â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let historicalOddsMap: Record<string, number> = {}
      let min30OddsMap: Record<string, number> = {}
      if (process.env.DATABASE_URL) {
        try {
          const sql = neon(process.env.DATABASE_URL)
          const d = meeting.date.replace(/[\/-]/g, "")
          const isoDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
          const [min15Rows, min30Rows] = await Promise.all([
            sql`
              SELECT runner_number, odds
              FROM odds_snapshots
              WHERE date = ${isoDate}
                AND venue = ${venueCode.toUpperCase()}
                AND race_no = ${raceNo}
                AND minutes_to_post BETWEEN -20 AND -10
              ORDER BY minutes_to_post DESC
            `,
            sql`
              SELECT runner_number, odds
              FROM odds_snapshots
              WHERE date = ${isoDate}
                AND venue = ${venueCode.toUpperCase()}
                AND race_no = ${raceNo}
                AND minutes_to_post BETWEEN -35 AND -25
              ORDER BY minutes_to_post DESC
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
        } catch (e: any) {
          console.error("Neon fetch odds failed", e.message)
        }
      }

      // â”€â”€ Build predictions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const runners: any[] = race.runners ?? []
      if (runners.length === 0) {
        return json(404, {
          error: `No runners found for Race ${raceNo} â€” field not yet declared`,
          raceNumber: raceNo,
          raceName: race.raceName_ch ?? race.raceName_en ?? `Race ${raceNo}`,
        })
      }
      const distance = parseInt(String(race.distance ?? '1200'), 10) || 1200
      const isSprint = distance <= 1200
      
      const goingStr = ((race.go_ch ?? '') + (race.go_en ?? '')).toUpperCase()
      const isWet = goingStr.includes("SOFT") || goingStr.includes("YIELDING")
      
      const groundKey = isWet ? "è®ŠåŒ–åœ°" : "æ­£å¸¸åœ°"
      const raceTypeKey = isSprint ? "çŸ­é€”" : "ä¸­é•·é€”"
      const statCategory = `${raceTypeKey}${groundKey}`

      const classLimit = getRatingMax(race.raceClass_en || race.raceClass_ch || "4")
      const benchmark = getWeightRDBenchmark(distance)
      const dynamicWeights = getDynamicWeights(distance, race.raceClass_en || race.raceClass_ch || "4")

      const predictions = runners.flatMap((r: any) => {
        try {
          const winOddsStr = r.winOdds || oddsMap[r.no.padStart(2, "0")] || oddsMap[r.no] || ""
          const hasOdds = winOddsStr !== ""
          const winOdds = hasOdds ? parseFloat(winOddsStr) : 99
          const weight = parseInt(r.handicapWeight as any) || 120
          const horseWeight = parseInt(r.currentWeight as any) || 1100
          const currentRating = parseInt(r.currentRating as any) || 0

          const last3Form = r.last6run
            ? r.last6run.split(/[/\- ]/).slice(0, 3).join("/")
            : "â€”"

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
        let ageStage = "veteran"
        let ageStageLabel = ""
        if (age <= 3) {
          ageBonus = AGE_FACTORS["2-3æ­²"]
          ageStage = "risingstar"
          ageStageLabel = "æ½›åŠ›æ–°æ˜Ÿ"
        } else if (age <= 5) {
          ageBonus = AGE_FACTORS["4-5æ­²"]
          ageStage = "primewarrior"
          ageStageLabel = "å·”å³°æˆ°å°‡"
        } else {
          ageBonus = AGE_FACTORS["6-10æ­²"]
          ageStage = "veteran"
          ageStageLabel = "æ²™å ´è€å°‡"
        }

        let c = 0.055
        if (distance >= 2200) c = 0.22
        else if (distance >= 1800) c = 0.16
        else if (distance >= 1400) c = 0.11

        const deltaW = weight - 120
        const deltaTBase = (deltaW / 2) * c

        let fGround = 1.0
        const goingStr = (race.go_ch || race.go_en || "").toUpperCase()
        if (goingStr.includes("å¤§çˆ›åœ°") || goingStr.includes("çˆ›") || goingStr.includes("HEAVY")) fGround = 1.3
        else if (
          goingStr.includes("è»Ÿ") ||
          goingStr.includes("SOFT") ||
          goingStr.includes("YIELDING") ||
          goingStr.includes("é»")
        )
          fGround = 1.15
        else if (
          goingStr.includes("å¥½è‡³å¿«") ||
          (goingStr.includes("å¥½") && goingStr.includes("å¿«")) ||
          goingStr.includes("GOOD TO FIRM") ||
          goingStr.includes("GOOD/FIRM")
        )
          fGround = 1.0
        else if (goingStr === "å¥½åœ°" || goingStr.includes("å¥½") || goingStr.includes("GOOD")) fGround = 1.05

        let fStyle = 1.0
        const runNums = (r.last6run ?? "").split(/[/\- ]/).map(Number).filter((n: number) => !isNaN(n) && n > 0)
        if (runNums.includes(1) || runNums.includes(2)) fStyle = 0.95
        else if (runNums.some((n: number) => n >= 9)) fStyle = 1.05

        const timeAdvantage = deltaTBase * fGround * fStyle
        const ratingScore = Math.min(1.0, currentRating / classLimit)
        const timeScore = Math.max(0, Math.min(1.0, 0.5 - timeAdvantage))

        const conditionMult = getConditionMult(last3Form)
        let conditionLabel = ""
        if (conditionMult >= 1.1) conditionLabel = "ä¸Šå‡ä¸­"
        else if (conditionMult >= 1.0) conditionLabel = "ç‹€æ…‹ç©©"
        else if (conditionMult <= 0.8) conditionLabel = "ç‹€æ…‹å·®"
        else conditionLabel = "ç•¥é™"

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
        if (weight > 130) riskFactors.push("è² ç£…éŽé‡(>130)")
        if (conditionMult < 0.9) riskFactors.push("ç‹€æ…‹ä¸‹æ»‘")
        if (weight / horseWeight > 0.13) riskFactors.push("è² ç£…é«”é‡æ¯”ç•°å¸¸(>13%)")
        if (age >= 8 && conditionMult < 1.0) riskFactors.push("è€é½¡é€€åŒ–")

        const displayOdds = hasOdds ? winOdds : "â€”"
        const placeOddsStr = placeOddsMap[r.no.padStart(2, "0")] || placeOddsMap[r.no] || ""
        const placeOdds = placeOddsStr ? parseFloat(placeOddsStr) : "â€”"

        const weightRatio = (weight / horseWeight) * 100
        const weightD = weight * distance

        let displayRunnerNumber: string | number = parseInt(r.no)
        if (
          !r.no ||
          isNaN(displayRunnerNumber as number) ||
          String(r.no).toLowerCase().includes("standby") ||
          String(r.no).includes("å¾Œå‚™")
        ) {
          const match = String(r.no || "").match(/\d+/)
          displayRunnerNumber = match ? `R${match[0]}` : "R"
        }

        // â”€â”€ Odds history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const oddsHistory: any = { overnight: null, min30: null, min15: null, current: displayOdds }
        const runnerKey = String(displayRunnerNumber).replace(/\D/g, "").padStart(2, "0")
        if (historicalOddsMap[runnerKey]) oddsHistory.min15 = historicalOddsMap[runnerKey]
        if (min30OddsMap[runnerKey]) oddsHistory.min30 = min30OddsMap[runnerKey]

        // Fallback: deterministic drift when no Neon data yet
        if (!oddsHistory.min15 && displayOdds !== "â€”") {
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

        // â”€â”€ Pool reverse-engineering (pre-race uses 28M/20M estimate) â”€â”€â”€â”€â”€
        const DEDUCT = 0.825
        const WIN_BASE = isPreRace ? 28_000_000 : poolsData.WIN
        const QIN_BASE = isPreRace ? 20_000_000 : poolsData.QIN

        const estWinInvestment =
          hasOdds && winOdds > 0
            ? Math.round((WIN_BASE * DEDUCT) / winOdds)
            : null

        const rNo = String(r.no).padStart(2, "0")
        let qinSum = 0
        Object.entries(qinOddsMap).forEach(([combo, odds]) => {
          if (odds > 0 && QIN_BASE > 0) {
            const parts = combo.split("-").map((x: string) => x.padStart(2, "0"))
            if (parts.includes(rNo)) qinSum += (QIN_BASE * DEDUCT) / odds
          }
        })
        const estQINInvestment = qinSum > 0 ? Math.round(qinSum) : null

        // â”€â”€ Large-bet detection (requires overnight odds in Neon) â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let moneyAlert: "large_bet" | "steady" | "drifting" | undefined
        if (oddsHistory.overnight && displayOdds !== "â€”") {
          const ov = parseFloat(String(oddsHistory.overnight))
          const cu = parseFloat(String(displayOdds))
          if (!isNaN(ov) && !isNaN(cu)) {
            const drop = (ov - cu) / ov
            moneyAlert = drop >= 0.3 ? "large_bet" : drop <= -0.2 ? "drifting" : "steady"
          }
        }

        return [{
          runnerNumber: displayRunnerNumber,
          runnerName: r.name_ch || r.name_en,
          jockey: r.jockey?.name_ch || r.jockey?.name_en || "æœªçŸ¥",
          trainer: r.trainer?.name_ch || r.trainer?.name_en || "æœªçŸ¥",
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
          analysis: `ã€${grade}ç´šã€‘ç¶œåˆè©•åˆ† ${(score / 100).toFixed(2)} (A:0.8+, B:0.6+)ã€‚${
            timeAdvantage < 0
              ? `å…·å‚™ ${Math.abs(timeAdvantage).toFixed(3)}s æ™‚é–“å„ªå‹¢`
              : timeAdvantage > 0
              ? `å­˜åœ¨ ${timeAdvantage.toFixed(3)}s æ™‚é–“åŠ£å‹¢`
              : `æ™‚é–“å·® 0.000s`
          }ã€‚ç´¯ç©è² æ“”(WeightRD) ${weightRD.toFixed(1)}ï¼Œæ¨™æº–å€é–“(${benchmark.toFixed(1)})ã€‚`,
          oddsHistory,
          estWinInvestment,
          estQINInvestment,
          moneyAlert,
          isTheoretical: isPreRace,
        }]
        } catch (runnerErr: any) {
          console.error(`Runner ${r?.no} parse error:`, runnerErr?.message)
          // Return a minimal fallback so the race still loads
          return [{
            runnerNumber: r?.no ?? '?',
            runnerName: r?.name_ch ?? r?.name_en ?? `Runner ${r?.no}`,
            jockey: r?.jockey?.name_ch ?? r?.jockey?.name_en ?? 'â€”',
            trainer: r?.trainer?.name_ch ?? r?.trainer?.name_en ?? 'â€”',
            draw: 0,
            weight: 120,
            winProbability: 0,
            placeProb: 0,
            winOdds: "â€”",
            placeOdds: "â€”",
            score: 0,
            grade: "D",
            rating: 0,
            horseWeight: 1000,
            last3Form: "â€”",
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
            ageStageLabel: "æœªçŸ¥",
            ageBonus: 1,
            conditionLabel: "æœªçŸ¥",
            conditionMultiplier: 1,
            marketImpliedProb: 0,
            winProbModel: 0,
            modelOdds: 0,
            diffProb: 0,
            expectedValue: 0,
            kellyFraction: 0,
            analysis: "è§£æžéŒ¯èª¤",
            oddsHistory: { overnight: null, min30: null, min15: null, current: "â€”" },
            estWinInvestment: null,
            estQINInvestment: null,
            moneyAlert: "steady",
            isTheoretical: true,
          }]
        }
      })

      // â”€â”€ Softmax win probability â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const expScores = predictions.map((p: any) => Math.exp(p.score / 20))
      const totalExp = expScores.reduce((a: number, b: number) => a + b, 0)

      predictions.forEach((p: any, idx: number) => {
        p.winProbModel = parseFloat((expScores[idx] / totalExp).toFixed(4))
        p.winProbability = Math.round(p.winProbModel * 100)
        p.modelOdds = parseFloat((1 / p.winProbModel - 1).toFixed(1))
        p.diffProb = parseFloat((p.winProbModel - p.marketImpliedProb).toFixed(4))

        if (p.winOdds !== "â€”") {
          const winOddsNum = parseFloat(p.winOdds as string)
          p.expectedValue = parseFloat((p.winProbModel * winOddsNum - 1).toFixed(2))
          if (winOddsNum > 1) {
            const kelly = p.expectedValue / (winOddsNum - 1)
            p.kellyFraction = parseFloat((Math.max(0, kelly) * 100).toFixed(1))
          }
        }

        // â”€â”€ Combat advice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const diffPct = p.diffProb * 100
        let advice = ""
        let combatStatus = "AVOID"
        const tieBreakerNotes: string[] = []

        if (p.weightRD < benchmark * 0.97) tieBreakerNotes.push("WeightRDå„ªå‹¢")
        const timeThreshold =
          (distance || 1200) <= 1200
            ? -0.1
            : (distance || 1200) <= 1650
            ? -0.2
            : (distance || 1200) <= 2000
            ? -0.3
            : -0.4
        if (p.timeAdvantage < timeThreshold) tieBreakerNotes.push("æ™‚é–“å·®å„ªå‹¢")
        if (p.ageBonus >= 1.0 && p.ageBonus < 1.05) tieBreakerNotes.push("å·”å³°æˆ°å°‡")

        const oddsDropping =
          p.oddsHistory.current != null &&
          p.oddsHistory.current !== "â€”" &&
          p.oddsHistory.min15 != null &&
          p.oddsHistory.min15 !== "â€”" &&
          parseFloat(String(p.oddsHistory.current)) < parseFloat(String(p.oddsHistory.min15))
        if (oddsDropping) tieBreakerNotes.push("è³ çŽ‡ä¸‹è·Œ(å¸‚å ´è³‡é‡‘æµå…¥)")

        const tb = tieBreakerNotes.length > 0 ? ` (+${tieBreakerNotes.join(", ")})` : ""

        if (diffPct >= -6 && diffPct <= -3) {
          advice = `âš¡å¸‚å ´åå¥½ Qä½é—œæ³¨${tb}`
          combatStatus = "SHADOW"
        } else if (diffPct < -3) {
          advice = "é¿å…æŠ•æ³¨ âš ï¸ (æ¨¡æ“¬å‹çŽ‡ < å¸‚å ´ï¼Œå¸‚å ´é«˜ä¼°æ­¤é¦¬)"
          combatStatus = "AVOID"
        } else if (diffPct > -3 && diffPct <= 0) {
          advice = `âš ï¸è§€æœ› (å·®å€¼å¾®è² )${tb}`
          combatStatus = "AVOID"
        } else if (diffPct > 0 && diffPct < 3) {
          advice = "ä¸æŠ•æ³¨ (å·®è· < 3% ä¸” EV åœ¨æŠ½æ°´å¾Œå¿…ç‚ºè² å€¼)"
          combatStatus = "AVOID"
        } else if (diffPct >= 3 && diffPct < 5) {
          if ((p.grade === "A" || p.grade === "B") && p.draw >= 1 && p.draw <= 6) {
            advice = `æœ€å°æ³¨ç¢¼è©¦æ³¨æˆ–è€ƒæ…®ä½ç½®(Qä½) (å·®è· 3-5% ä¸”å…·å‚™ A/B ç´šèˆ‡1-6æª”ä½)${tb}`
            combatStatus = "CAUTION"
          } else {
            advice = `æ”¹æŠ•ä½ç½®æˆ–è§€æœ› (å·®è· 3-5%ï¼Œç„¡æª”ä½/è©•ç´šå„ªå‹¢)${tb}`
            combatStatus = "CAUTION"
          }
        } else if (diffPct >= 5) {
          advice = `ç©æ¥µæŠ•æ³¨ â­â­â­ (å·®è· â‰¥ 5%ï¼Œå…·å‚™æ­£æœŸæœ›å€¼)${tb}`
          combatStatus = "GO"
        } else {
          advice = "æœ€ä½³ç­–ç•¥æ˜¯ä¸æŠ•æ³¨ï¼Œç­‰å¾…ä¸‹ä¸€å ´æ›´æ˜Žç¢ºçš„æ©Ÿæœƒ"
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

            // â”€â”€ Odds structure classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const oddsStructure = analyzeOddsStructure(predictions, isPreRace)

      const validPredictions = predictions.filter((p: any) => !String(p.runnerNumber).startsWith("R"))
      const topPick = validPredictions.length > 0 ? validPredictions[0] : predictions[0]
      const hasDarkHorse = validPredictions.some((p: any) => p.investmentLabel === "DARKHORSE")
      const highRiskRunners = validPredictions.filter((p: any) => p.investmentLabel === "RISK").length

      const summaryText = `AI å››ç¶­åº¦åˆ†æžï¼ˆæŒ‰æ¨¡åž‹è³ çŽ‡æŽ’åï¼‰ï¼šé¦–é¸ #${topPick.runnerNumber} ${topPick.runnerName}ï¼ˆæ¨¡åž‹è³ çŽ‡ ${topPick.modelOdds}ï¼‰ã€‚${
        hasDarkHorse ? "æœ¬å ´å­˜åœ¨æ½›åœ¨é»‘é¦¬ï¼Œ" : ""
      }${highRiskRunners > 0 ? `æœ‰ ${highRiskRunners} åŒ¹é«˜é¢¨éšªè³½é§’éœ€è­¦æƒ•ã€‚` : "å…¨å ´ç‹€æ…‹ç›¸å°ç©©å®šã€‚"}`

      const raceDetail = {
        id: race.id,
        raceNumber: race.no,
        raceName: race.raceName_ch || race.raceName_en || `ç¬¬ ${race.no} å ´`,
        distance: race.distance,
        distanceMeters: distance,
        benchmarkRD: benchmark,
        course: race.raceCourse?.description_ch || race.raceCourse?.description_en || "è‰åœ°",
        raceClass: race.raceClass_ch || race.raceClass_en || "",
        runners: race.wageringFieldSize || runners.length,
        totalRaces: (meeting as any).totalRaces || meeting.races?.length || 11,
        meetingId: meeting.id || "current",
        venueCode,
        date: meeting.date,
        track: race.raceTrack?.description_ch || race.raceTrack?.description_en || "è‰åœ°",
        going: race.go_ch || race.go_en || "å¥½åœ°",
        postTime: race.postTime,
        meetingType: meeting.meetingType === "N" ? "å¤œè³½" : "æ—¥è³½",
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

    return json(404, { error: "Not found" })
  } catch (e: any) {
    return json(500, { error: e?.message || "Internal error" })
  }
}
