/**
 * poll-odds.ts
 * ============
 * Netlify Scheduled Function — 每 5 分鐘執行一次
 * 1. 用 hkjc-api 抓取全場現在賠率
 * 2. 寫入 Neon odds_snapshots 表（已容錯重複快照）
 *
 */
import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions"
import { neon } from "@neondatabase/serverless"
import { HorseRacingAPI, HKJCClient } from "hkjc-api"
import { horseOddsQuery } from "hkjc-api/dist/query/horseRacingQuery.js"

const sql = neon(process.env.DATABASE_URL!)

// ---- 輔助函數 ----

/** 將 HKJC meeting.date 轉為 DATE 字串 YYYY-MM-DD */
function toISODate(hkjcDate: string): string {
  const d = hkjcDate.replace(/[\/\-]/g, "")
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

/** 計算距開飛分鐘數（負數 = 未開飛）*/
function minutesToPost(postTime: string | undefined): number {
  if (!postTime) return -999
  try {
    const [h, m] = postTime.split(":").map(Number)
    if (isNaN(h) || isNaN(m)) return -999
    const now = new Date()
    const postMs = new Date(now)
    postMs.setHours(h, m, 0, 0)
    const result = Math.round((postMs.getTime() - now.getTime()) / 60000)
    return isNaN(result) ? -999 : result
  } catch {
    return -999
  }
}

/** 將 mtp 映射至 bucket（對應 DB CHECK constraint）*/
function getMtpBucket(mtp: number): number {
  if (mtp > 60) return 90
  if (mtp > 30) return 60
  if (mtp > 15) return 30
  if (mtp > 5)  return 15
  if (mtp > 0)  return 5
  return 0
}

// ---- 主 handler ----
export const handler: Handler = async (
  _event: HandlerEvent,
  _context: HandlerContext
) => {
  if (!process.env.DATABASE_URL) {
    console.error("[poll-odds] DATABASE_URL 未設定")
    return { statusCode: 500, body: "DATABASE_URL missing" }
  }

  const horseAPI = new HorseRacingAPI()
  const hkjcClient = new HKJCClient()
  let totalInserted = 0
  const errors: string[] = []

  try {
    const meetings = await horseAPI.getAllRaces()
    if (!meetings || meetings.length === 0) {
      console.log("[poll-odds] 無活躍賽事日")
      return { statusCode: 200, body: JSON.stringify({ inserted: 0, message: "無活躍賽事日" }) }
    }

    for (const meeting of meetings) {
      const raceDate = toISODate(meeting.date)
      const venue = (meeting.venueCode as string).toUpperCase().slice(0, 2)
      const races = meeting.races || []

      for (const race of races) {
        const raceNo = parseInt(race.no)
        if (isNaN(raceNo)) continue

        const mtp = minutesToPost(race.postTime)
        if (isNaN(mtp)) continue
        if (mtp < -10 || mtp > 120) continue

        const mtpBucket = getMtpBucket(mtp)
        const safeMtp = Math.max(-32768, Math.min(32767, mtp)) // smallint range

        let oddsNodes: Array<{ combString: string; oddsValue: string }> = []
        try {
          const oddsResponse: any = await hkjcClient.request(horseOddsQuery, {
            date: meeting.date,
            venueCode: meeting.venueCode,
            raceNo,
            oddsTypes: ["WIN"],
          })
          const pools = oddsResponse.raceMeetings?.[0]?.pmPools || []
          const winPool = pools.find((p: any) => p.oddsType === "WIN")
          oddsNodes = winPool?.oddsNodes || []
        } catch (e: any) {
          errors.push(`賠率抓取失敗 ${venue} R${raceNo}: ${e?.message}`)
          continue
        }

        if (oddsNodes.length === 0) continue

        const runnersMap: Record<string, string> = {}
        const runners = race.runners || []
        for (const r of runners) {
          const key = String(r.no).padStart(2, "0")
          runnersMap[key] = r.name_ch || r.name_en || ""
        }

        try {
          const queries = oddsNodes.map((node) => {
            const paddedNo = String(node.combString).padStart(2, "0")
            const horseName = runnersMap[paddedNo] || runnersMap[node.combString] || ""
            const odds = parseFloat(node.oddsValue)
            if (isNaN(odds)) return null

            // Use the calculated mtpBucket from upstream
            return sql`
              INSERT INTO odds_snapshots
                (date, venue, race_no, runner_number, horse_name, odds, minutes_to_post, mtp_bucket)
              VALUES
                (${raceDate}, ${venue}, ${raceNo}, ${node.combString}, ${horseName}, ${odds}, ${safeMtp}, ${mtpBucket})
              ON CONFLICT (date, venue, race_no, runner_number, mtp_bucket) 
              DO UPDATE SET odds = EXCLUDED.odds, minutes_to_post = EXCLUDED.minutes_to_post
            `
          }).filter(Boolean) as any[]

          if (queries.length > 0) {
            await sql.transaction(queries)
            totalInserted += queries.length
          }
        } catch (e: any) {
          errors.push(`Neon 寫入失敗 ${venue} R${raceNo}: ${e?.message}`)
        }
      }
    }

    console.log(`[poll-odds] 完成: 寫入 ${totalInserted} 筆賠率快照`)
    return {
      statusCode: 200,
      body: JSON.stringify({
        inserted: totalInserted,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString(),
      }),
    }
  } catch (e: any) {
    console.error("[poll-odds] 差錢錯誤:", e)
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || "unknown error" }) }
  }
}

export const config = {
  schedule: "*/5 * * * *",
}
