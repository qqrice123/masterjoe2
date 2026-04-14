import { neon } from "@neondatabase/serverless"
import { HorseRacingAPI, HKJCClient } from "hkjc-api"
import { horseOddsQuery, horsePoolQuery } from "hkjc-api/dist/query/horseRacingQuery.js"
import * as dotenv from "dotenv"

dotenv.config()
const sql = neon(process.env.DATABASE_URL!)

function toISODate(d: string) { return d }
function minutesToPost(d: string) { return 60 }
function getMtpBucket(m: number) { return 60 }

async function test() {
  const raceDate = '2026-04-15'
  const venue = 'HV'
  const raceNo = 1
  const prevSnapshots = await sql`
    SELECT DISTINCT ON (runner_number) runner_number, odds 
    FROM odds_snapshots 
    WHERE date = ${raceDate} AND venue = ${venue} AND race_no = ${raceNo}
    ORDER BY runner_number, snaptime DESC
  `
  console.log("Prev:", prevSnapshots.find(s => s.runner_number === '01'))
}
test()
