import type { Handler } from "@netlify/functions"
import { HorseRacingAPI, HKJCClient } from "hkjc-api"
import { horseOddsQuery } from "hkjc-api/dist/query/horseRacingQuery.js"
import { neon } from "@neondatabase/serverless"
import axios from "axios"
import * as cheerio from "cheerio"

const horseAPI = new HorseRacingAPI()
const hkjcClient = new HKJCClient()

// SpeedPro and Racecard scraping logic has been removed.
// All data is sourced exclusively from the HKJC GraphQL API.

const STAT_WIN_RATES: Record<string, Record<string, number>> = {
  短途正常地: { "<119": 50.0, "120-124": 57.8, "125-129": 25.0, "130+": 57.1 },
  短途變化地: { "<119": 27.27, "120-124": 48.0, "125-129": 46.67, "130+": 57.14 },
  中長途正常地: { "<119": 37.5, "120-124": 46.2, "125-129": 54.5, "130+": 60.0 },
  中長途變化地: { "<119": 37.5, "120-124": 36.11, "125-129": 40.54, "130+": 37.5 },
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
  if (cls === 'A1' || cls.includes('CLASS 1') || cls === 'G1' || cls.includes('GROUP 1')) return 90
  if (cls === 'A2' || cls.includes('CLASS 2') || cls === 'G2' || cls.includes('GROUP 2')) return 105
  if (cls === 'A3' || cls.includes('CLASS 3') || cls === 'G3' || cls.includes('GROUP 3')) return 120
  if (cls === 'A') return 75
  if (cls === 'B') return 60
  if (cls === 'C') return 45
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
    // Recent seasons based on 2024/2025 calculation
    N: 2,  // 2024/25
    M: 3,  // 2023/24
    L: 3,  // 2022/23
    K: 4,  // 2021/22
    J: 5,  // 2020/21
    H: 6,  // 2019/20
    G: 7,  // 2018/19
    E: 8,  // 2017/18
    D: 9,  // 2016/17
    C: 10, // 2015/16
  }
  return seasonMap[letter] || 5
}

function getConditionMult(last3Form: string): number {
  const positions = last3Form.split(/[/\-]/).map(Number).filter(n => !isNaN(n) && n > 0)
  if (positions.length === 0) return 1.0
  const avg = positions.reduce((a, b) => a + b, 0) / positions.length
  if (positions[0] <= 2 && avg <= 3)   return 1.2   // 近期頂尖
  if (positions[0] <= 3)               return 1.1   // 近期上佳
  if (avg >= 8)                        return 0.8   // 近期差勁
  if (avg >= 6)                        return 0.9   // 近期欠佳
  return 1.0
}

function getDynamicWeights(distance: number, raceClass: string) {
  let wStat = 0.35
  let wBurden = 0.25
  let wRating = 0.15
  let wAge = 0.10
  let wTime = 0.15

  const cls = raceClass.toUpperCase()
  const isHighClass = cls.includes('CLASS 1') || cls.includes('CLASS 2') || cls.includes('CLASS 3') 
                   || cls === 'A1' || cls === 'A2' || cls === 'A3' 
                   || cls.includes('GROUP 1') || cls.includes('GROUP 2') || cls.includes('GROUP 3')
                   || cls.includes('G1') || cls.includes('G2') || cls.includes('G3')
  const isLowClass  = cls.includes('CLASS 4') || cls.includes('CLASS 5') || cls === 'A' || cls === 'B' || cls === 'C'

  if (distance <= 1200) {
    wBurden = 0.20
    wTime = 0.20
    wRating = 0.15
  } else if (distance >= 2000) {
    wStat = 0.35
    wRating = 0.20
    wTime = 0.05
  }

  if (isHighClass) {
    wRating = 0.25
    wStat = 0.30
  } else if (isLowClass) {
    wBurden = 0.20
    wAge = 0.15
  }

  const total = wStat + wBurden + wRating + wAge + wTime
  return { wStat: wStat / total, wBurden: wBurden / total, wRating: wRating / total, wAge: wAge / total, wTime: wTime / total }
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

    const predictMatch = pathname.match(/^\/predict\/([^/]+)\/(\d+)/)
    if (predictMatch) {
      const venueCode = predictMatch[1]
      const raceNo = parseInt(predictMatch[2])
      const meetings = await horseAPI.getAllRaces()
      if (!meetings || meetings.length === 0) return json(404, { error: "No meetings found" })

      const meeting = meetings.find((m: any) => m.venueCode === venueCode)
      if (!meeting) return json(404, { error: `Meeting for venue ${venueCode} not found` })

      const race = meeting.races?.find((r: any) => r.no === raceNo || r.no === String(raceNo))
      if (!race) return json(404, { error: "未找到賽事" })

      // Fetch odds map and fallback logic
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
      } catch {
        // ignore
      }

      // Fetch historical odds from Neon
      let historicalOddsMap: Record<string, number> = {}
      let min30OddsMap: Record<string, number> = {}
      
      if (process.env.DATABASE_URL) {
        try {
          const sql = neon(process.env.DATABASE_URL)
          
          // HKJC date format conversion to match our Neon schema
          const d = meeting.date.replace(/[\/-]/g, "")
          const isoDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
          
          // 並行查詢兩個時間段的賠率
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
            `
          ]);
          
          // Get the closest available snapshot for each horse in that window
          min15Rows.forEach((row: any) => {
            const runnerNum = String(row.runner_number).padStart(2, "0")
            if (!historicalOddsMap[runnerNum]) {
              historicalOddsMap[runnerNum] = parseFloat(row.odds)
            }
          })
          
          min30Rows.forEach((row: any) => {
            const runnerNum = String(row.runner_number).padStart(2, "0")
            if (!min30OddsMap[runnerNum]) {
              min30OddsMap[runnerNum] = parseFloat(row.odds)
            }
          })
        } catch (e: any) {
          console.error("Neon fetch odds failed", e.message)
        }
      }

      const runners = race.runners || []
      const distance = Number(race.distance) || 1200
      const isSprint = distance <= 1200
      const isWet =
        (race.go_en || "").toUpperCase().includes("SOFT") || (race.go_en || "").toUpperCase().includes("YIELDING")
      const groundKey = isWet ? "變化地" : "正常地"
      const raceTypeKey = isSprint ? "短途" : "中長途"
      const statCategory = `${raceTypeKey}${groundKey}`

      const classLimit = getRatingMax(race.raceClass_en || race.raceClass_ch || "4")
      const benchmark = getWeightRDBenchmark(distance)
      const dynamicWeights = getDynamicWeights(distance, race.raceClass_en || race.raceClass_ch || "4")

      const predictions = runners.map((r: any) => {
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
        let ageStage = "veteran"
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
        const goingStr = (race.go_ch || race.go_en || "").toUpperCase()
        if (goingStr.includes("大爛地") || goingStr.includes("爛") || goingStr.includes("HEAVY")) fGround = 1.3
        else if (goingStr.includes("軟") || goingStr.includes("SOFT") || goingStr.includes("YIELDING") || goingStr.includes("黏")) fGround = 1.15
        else if (goingStr.includes("好至快") || (goingStr.includes("好") && goingStr.includes("快")) || goingStr.includes("GOOD TO FIRM") || goingStr.includes("GOOD/FIRM")) fGround = 1.0
        else if (goingStr === "好地" || goingStr.includes("好") || goingStr.includes("GOOD")) fGround = 1.05

        let fStyle = 1.0
        const runNums = (r.last6run ?? "").split(/[/\- ]/).map(Number).filter(n => !isNaN(n) && n > 0);
        if (runNums.includes(1) || runNums.includes(2)) fStyle = 0.95
        else if (runNums.some(n => n >= 9)) fStyle = 1.05

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

        const rawScore = (statScore * wStat + burdenScore * wBurden + ratingScore * wRating + ageBonus * wAge + timeScore * wTime) * 100
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
        if (!r.no || isNaN(displayRunnerNumber) || String(r.no).toLowerCase().includes("standby") || String(r.no).includes("後備")) {
          const match = String(r.no || "").match(/\d+/)
          displayRunnerNumber = match ? `R${match[0]}` : "R"
        }

        // Odds history handling
        const oddsHistory: any = {
          overnight: null,
          min30: null,
          min15: null,
          current: displayOdds
        };
        
        // Fetch real historical odds from Neon if available, otherwise fallback to deterministic drift
        const runnerKey = String(displayRunnerNumber).replace(/\D/g, "").padStart(2, "0");
        if (historicalOddsMap[runnerKey]) {
          oddsHistory.min15 = historicalOddsMap[runnerKey];
        }
        
        if (min30OddsMap[runnerKey]) {
          oddsHistory.min30 = min30OddsMap[runnerKey];
        }

        // Fallback for missing data
        if (!oddsHistory.min15 && displayOdds !== "—") {
           const oddsNum = parseFloat(String(displayOdds));
           if (!isNaN(oddsNum)) {
              // Determine a slight drift (-5% to +5%) based on horse number to be deterministic
              const num = typeof displayRunnerNumber === 'string' ? parseInt(displayRunnerNumber.replace(/\D/g, "")) || 0 : displayRunnerNumber;
              const drift = (num % 11 - 5) / 100; 
              oddsHistory.min15 = parseFloat((oddsNum * (1 - drift)).toFixed(1));
           }
        }

        return {
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
            timeAdvantage < 0 ? `具備 ${Math.abs(timeAdvantage).toFixed(3)}s 時間優勢` : timeAdvantage > 0 ? `存在 ${timeAdvantage.toFixed(3)}s 時間劣勢` : `時間差 0.000s`
          }。累積負擔(WeightRD) ${weightRD.toFixed(1)}，標準區間(${benchmark.toFixed(1)})。`,
          oddsHistory,
        }
      })

      const expScores = predictions.map((p: any) => Math.exp(p.score / 20))
      const totalExp = expScores.reduce((a: number, b: number) => a + b, 0)

      predictions.forEach((p: any, idx: number) => {
        p.winProbModel = parseFloat((expScores[idx] / totalExp).toFixed(4))
        p.winProbability = Math.round(p.winProbModel * 100)
        p.modelOdds = parseFloat((1 / p.winProbModel - 1).toFixed(1))
        p.diffProb = parseFloat((p.winProbModel - p.marketImpliedProb).toFixed(4))

        if (p.winOdds !== "—") {
          const winOddsNum = parseFloat(p.winOdds as string)
          // Standard expected net return: p * odds - 1
          p.expectedValue = parseFloat((p.winProbModel * winOddsNum - 1).toFixed(2))
          if (winOddsNum > 1) {
            const kelly = p.expectedValue / (winOddsNum - 1)
            p.kellyFraction = parseFloat((Math.max(0, kelly) * 100).toFixed(1))
          }
        }

        // Combat Advice Logic based on new System Principles
          const diffProbPercentage = p.diffProb * 100;
          let advice = "";
          let combatStatus = "AVOID";
          let tieBreakerNotes = [];

          if (p.weightRD < benchmark * 0.97) tieBreakerNotes.push("WeightRD優勢");
          const timeThreshold = (distance || 1200) <= 1200 ? -0.1 : (distance || 1200) <= 1650 ? -0.2 : (distance || 1200) <= 2000 ? -0.3 : -0.4;
           if (p.timeAdvantage < timeThreshold) tieBreakerNotes.push("時間差優勢");
          if (p.ageBonus >= 1.0 && p.ageBonus < 1.05) tieBreakerNotes.push("巔峰戰將"); 
          
          // 檔位與賠率走勢: 若賠率持續下跌（市場資金流入），代表市場在修正
          const oddsDropping = p.oddsHistory.current != null && p.oddsHistory.current !== "—" && 
                               p.oddsHistory.min15 != null && p.oddsHistory.min15 !== "—" && 
                               parseFloat(String(p.oddsHistory.current)) < parseFloat(String(p.oddsHistory.min15));
          if (oddsDropping) tieBreakerNotes.push("賠率下跌(市場資金流入)");

          const tieBreakerStr = tieBreakerNotes.length > 0 ? ` (+${tieBreakerNotes.join(", ")})` : "";

          // 核心概念判斷：正優勢 (≥5%), 接近/灰色地帶 (<5%), 負優勢 (<0)
          if (diffProbPercentage >= -6 && diffProbPercentage <= -3) {
             advice = `⚡市場偏好 Q位關注${tieBreakerStr}`;
             combatStatus = "SHADOW";   // 甜蜜區間：市場早於模型識別
          } else if (diffProbPercentage < -3) {
             advice = "避免投注 ⚠️ (模擬勝率 < 市場，市場高估此馬)";
             combatStatus = "AVOID";
          } else if (diffProbPercentage > -3 && diffProbPercentage <= 0) {
             advice = `⚠️觀望 (差值微負)${tieBreakerStr}`;
             combatStatus = "AVOID";
          } else if (diffProbPercentage > 0 && diffProbPercentage < 3) {
             advice = "不投注 (差距 < 3% 且 EV 在抽水後必為負值)";
             combatStatus = "AVOID";
          } else if (diffProbPercentage >= 3 && diffProbPercentage < 5) {
             if ((p.grade === "A" || p.grade === "B") && p.draw >= 1 && p.draw <= 6) {
                advice = `最小注碼試注或考慮位置(Q位) (差距 3-5% 且具備 A/B 級與1-6檔位)${tieBreakerStr}`;
                combatStatus = "CAUTION";
             } else {
                advice = `改投位置或觀望 (差距 3-5%，無檔位/評級優勢)${tieBreakerStr}`;
                combatStatus = "CAUTION";
             }
          } else if (diffProbPercentage >= 5) {
             advice = `積極投注 ⭐⭐⭐ (差距 ≥ 5%，具備正期望值)${tieBreakerStr}`;
             combatStatus = "GO";
          } else {
             advice = "最佳策略是不投注，等待下一場更明確的機會";
             combatStatus = "AVOID";
          }
          
          p.combatAdvice = advice;
          p.combatStatus = combatStatus;

        if (p.grade === "A") p.investmentLabel = "BEST"
        else if (p.grade === "B") p.investmentLabel = "STABLE"
        else if (p.expectedValue > 0 && p.weight <= 118 && p.weightRD < benchmark) p.investmentLabel = "DARKHORSE"

        if (p.riskFactors.length > 0 && p.investmentLabel !== "BEST") p.investmentLabel = "RISK"
      })

      predictions.sort((a: any, b: any) => {
        if (a.modelOdds !== b.modelOdds) return a.modelOdds - b.modelOdds
        if (a.winProbModel !== b.winProbModel) return b.winProbModel - a.winProbModel
        return a.runnerNumber - b.runnerNumber
      })

      // Filter out reserve horses before calculating summary metrics
      const validPredictions = predictions.filter((p: any) => !String(p.runnerNumber).startsWith('R'));
      const topPick = validPredictions.length > 0 ? validPredictions[0] : predictions[0];
      const hasDarkHorse = validPredictions.some((p: any) => p.investmentLabel === "DARKHORSE")
      const highRiskRunners = validPredictions.filter((p: any) => p.investmentLabel === "RISK").length

      const summaryText = `AI 四維度分析（按模型賠率排名）：首選 #${topPick.runnerNumber} ${topPick.runnerName}（模型賠率 ${topPick.modelOdds}）。${
          hasDarkHorse ? "本場存在潛在黑馬，" : ""
        }${highRiskRunners > 0 ? `有 ${highRiskRunners} 匹高風險賽駒需警惕。` : "全場狀態相對穩定。"}`;

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
        summary: summaryText,
        aiSummary: summaryText,
        confidence: topPick.winProbModel >= 0.18 ? "HIGH" : topPick.winProbModel >= 0.1 ? "MEDIUM" : "LOW",
      }

      return json(200, raceDetail)
    }

    return json(404, { error: "Not found" })
  } catch (e: any) {
    return json(500, { error: e?.message || "Internal error" })
  }
}
