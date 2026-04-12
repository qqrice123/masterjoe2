/**
 * log-result.ts
 * =============
 * Netlify Scheduled Function + Manual POST endpoint
 * 
 * AUTO: Runs daily at UTC 12:30 (= HKT 20:30) to scrape full-day race results from HKJC
 * MANUAL: POST /.netlify/functions/log-result?date=YYYY-MM-DD to trigger for a specific date
 * 
 * Flow:
 * 1. Fetch HKJC race result pages (HTML)
 * 2. Parse finish positions, horse names, odds, race info
 * 3. INSERT INTO race_results (ON CONFLICT UPDATE)
 * 4. REFRESH MATERIALIZED VIEW statwinrates
 */

import { neon } from "@neondatabase/serverless"
import { parse } from "node-html-parser"
import type { Config } from "@netlify/functions"

const sql = neon(process.env.DATABASE_URL!)

// HKJC results page URL (Chinese version for matching go_ch and raceClass_ch)
const HKJC_RESULT_URL = "https://racing.hkjc.com/zh-hk/local/information/localresults"

interface RaceResult {
  date: string
  venue: string
  race_no: number
  race_name: string
  distance: number
  race_class: string
  going: string
  runner_number: string
  horse_name: string
  weight: number
  win_odds: number
  finish_pos: number
}

function deriveWeightBand(weight: number | null): string | null {
  if (!weight) return null
  if (weight >= 130) return "130+"
  if (weight >= 125) return "125-129"
  if (weight >= 120) return "120-124"
  return "<119"
}

export const handler = async (event: any) => {
  if (!process.env.DATABASE_URL) {
    return { statusCode: 500, body: JSON.stringify({ error: "DATABASE_URL not set" }) }
  }

  // Support manual date override via query param or POST body
  let date: string
  if (event.queryStringParameters?.date) {
    date = event.queryStringParameters.date
  } else if (event.body) {
    try {
      const body = JSON.parse(event.body)
      date = body.date || new Date().toLocaleDateString("en-CA")
    } catch {
      date = new Date().toLocaleDateString("en-CA")
    }
  } else {
    date = new Date().toLocaleDateString("en-CA")
  }

  const formattedDate = date.replace(/-/g, "/") // 2026/04/10

  console.log(`[log-result] Fetching results for date: ${date}`)

  try {
    const allResults: RaceResult[] = []

    // Fetch up to 12 races
    for (let raceNo = 1; raceNo <= 12; raceNo++) {
      const url = `${HKJC_RESULT_URL}?RaceDate=${formattedDate}&RaceNo=${raceNo}`
      let res: Response
      try {
        res = await fetch(url, {
          headers: { "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0" }
        })
      } catch (e: any) {
        console.error(`[log-result] Fetch failed for race ${raceNo}:`, e?.message)
        break
      }

      if (!res.ok) break
      const html = await res.text()
      const root = parse(html)

      // Check if results table exists (race completed)
      const resultTable = root.querySelector(".performance")
      if (!resultTable) {
        console.log(`[log-result] Race ${raceNo}: no results yet, stopping`)
        break
      }

      // Parse race metadata from the Chinese page
      const tbodyElements = root.querySelectorAll(".f_fs13")
      const raceInfoText = tbodyElements.length > 1 ? tbodyElements[1].text : (tbodyElements[0]?.text ?? "")
      
      const distanceMatch = raceInfoText.match(/(\d{4})\s*米/i)
      const goingMatch = raceInfoText.match(/場地狀況\s*:\s*([^\n\r]+)/i)
      const classMatch = raceInfoText.match(/(第[一二三四五六]班|[^\n\r]+賽)/)
      
      const isHV = root.innerHTML.includes("跑馬地")
      const venue = isHV ? "HV" : "ST"
      const raceNameEl = root.querySelector(".bg_blue.color_w.font_wb")

      const distance = distanceMatch ? parseInt(distanceMatch[1]) : 0
      const going = goingMatch ? goingMatch[1].trim() : ""
      const raceClass = classMatch ? classMatch[1].trim() : "Open"
      const raceName = raceNameEl?.text?.trim().replace(/\s+/g, ' ') ?? ""

      // Parse each horse row
      const rows = resultTable.querySelectorAll("tr")
      let parsed = 0
      for (const row of rows) {
        const cells = row.querySelectorAll("td")
        if (cells.length < 6) continue

        const finishPos = parseInt(cells[0].text.trim())
        if (isNaN(finishPos)) continue

        const runnerNumber = cells[1].text.trim()
        let horseName = cells[2].text.trim()
        // Remove brand number e.g. "通情達理 (L183)" -> "通情達理"
        horseName = horseName.replace(/\s*\(.*?\)\s*/g, '').trim()
        const weight = parseInt(cells[4].text.trim()) || 0
        // Win odds is usually second-to-last column
        const winOdds = parseFloat(cells[cells.length - 2].text.trim()) || 0

        allResults.push({
          date,
          venue,
          race_no: raceNo,
          race_name: raceName,
          distance,
          race_class: raceClass,
          going,
          runner_number: runnerNumber,
          horse_name: horseName,
          weight,
          win_odds: winOdds,
          finish_pos: finishPos,
        })
        parsed++
      }

      console.log(`[log-result] Race ${raceNo} (${venue}): ${parsed} runners parsed`)
    }

    if (allResults.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "No results available yet for today", date }),
      }
    }

    // Batch insert into Neon with ON CONFLICT UPDATE
    await sql.transaction(
      allResults.map(r => {
        const weightBand = deriveWeightBand(r.weight)
        return sql`
          INSERT INTO race_results (
            date, venue, race_no, race_name, distance, race_class,
            going, weight_band, runner_number, horse_name,
            weight, win_odds, finish_pos
          ) VALUES (
            ${r.date}, ${r.venue}, ${r.race_no}, ${r.race_name},
            ${r.distance}, ${r.race_class}, ${r.going}, ${weightBand},
            ${r.runner_number}, ${r.horse_name}, ${r.weight || null},
            ${r.win_odds || null}, ${r.finish_pos}
          )
          ON CONFLICT (date, venue, race_no, runner_number)
          DO UPDATE SET
            finish_pos = EXCLUDED.finish_pos,
            win_odds = EXCLUDED.win_odds,
            going = EXCLUDED.going,
            race_name = EXCLUDED.race_name
        `
      })
    )

    // Refresh materialized view (safe to run even with < 5 rows)
    try {
      await sql`REFRESH MATERIALIZED VIEW statwinrates`
      console.log("[log-result] statwinrates refreshed")
    } catch (e: any) {
      console.warn("[log-result] statwinrates refresh skipped:", e?.message)
    }

    const racesProcessed = [...new Set(allResults.map(r => r.race_no))].length
    console.log(`[log-result] Done: ${allResults.length} rows, ${racesProcessed} races, date=${date}`)

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        inserted: allResults.length,
        racesProcessed,
        date,
        timestamp: new Date().toISOString(),
      }),
    }
  } catch (err: any) {
    console.error("[log-result] Error:", err)
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || "unknown error" }) }
  }
}

// Netlify Scheduled Function: daily at UTC 12:30 = HKT 20:30
export const config: Config = {
  schedule: "30 12 * * *",
}
