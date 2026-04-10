import type { Config } from "@netlify/functions"
import { HorseRacingAPI, HKJCClient } from "hkjc-api"
import { horseOddsQuery } from "hkjc-api/dist/query/horseRacingQuery.js"
import { neon } from "@neondatabase/serverless"

const horseAPI = new HorseRacingAPI()
const hkjcClient = new HKJCClient()

export default async function handler() {
  if (!process.env.DATABASE_URL) return new Response("No DB", { status: 500 })
  const sql = neon(process.env.DATABASE_URL)

  const meetings = await horseAPI.getAllRaces()
  if (!meetings?.length) return new Response("No meetings", { status: 200 })

  for (const meeting of meetings) {
    for (const race of meeting.races || []) {
      const raceNo = parseInt(race.no)
      const now = new Date()
      const postTime = new Date(race.postTime)
      const minutesToPost = Math.round((postTime.getTime() - now.getTime()) / 60000)

      // Only record within 3 hours before race
      if (minutesToPost > 180 || minutesToPost < -5) continue

      try {
        const res: any = await hkjcClient.request(horseOddsQuery, {
          date: meeting.date,
          venueCode: meeting.venueCode,
          raceNo,
          oddsTypes: ["WIN"],
        })
        const winPool = (res.raceMeetings[0]?.pmPools || [])
          .find((p: any) => p.oddsType === "WIN")

        if (!winPool?.oddsNodes?.length) continue

        const d = meeting.date.replace(/[\/-]/g, "")
        const isoDate = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`

        for (const node of winPool.oddsNodes) {
          const odds = parseFloat(node.oddsValue)
          if (isNaN(odds) || odds <= 0) continue
          await sql`
            INSERT INTO odds_snapshots (date, venue, race_no, runner_number, odds, minutes_to_post)
            VALUES (${isoDate}, ${meeting.venueCode}, ${raceNo},
                    ${parseInt(node.combString)}, ${odds}, ${minutesToPost})
            ON CONFLICT DO NOTHING
          `
        }
      } catch { /* ignore per-race errors */ }
    }
  }
  return new Response("OK", { status: 200 })
}

export const config: Config = {
  schedule: "*/15 * * * *"  // 每15分鐘執行一次
}
