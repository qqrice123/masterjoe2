// ══════════════════════════════════════════════════════════════════════════════
// Database Connection Manager with Pooling
// Optimized for Netlify Functions (Serverless)
// ══════════════════════════════════════════════════════════════════════════════

import { neon, Pool } from '@neondatabase/serverless'

let cachedPool: ReturnType<typeof neon> | null = null

/**
 * Get or create a singleton Neon database connection.
 * Reuses connection across multiple function invocations in the same container.
 * 
 * @returns Neon SQL client
 * @throws Error if DATABASE_URL is not configured
 */
export function getDb(): ReturnType<typeof neon> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not configured')
  }

  if (!cachedPool) {
    cachedPool = neon(process.env.DATABASE_URL)
    console.log('[DB] Created new Neon connection')
  }

  return cachedPool
}

/**
 * Execute a database query with automatic error handling and logging.
 * 
 * @param queryFn - Function that performs the database query
 * @param context - Context string for logging (e.g., "fetch odds", "get meetings")
 * @returns Query result or null on error
 */
export async function safeQuery<T>(
  queryFn: (sql: ReturnType<typeof neon>) => Promise<T>,
  context: string
): Promise<T | null> {
  try {
    const sql = getDb()
    const result = await queryFn(sql)
    return result
  } catch (error) {
    console.error(`[DB Error] ${context}:`, error instanceof Error ? error.message : String(error))
    return null
  }
}

/**
 * Fetch historical odds from database.
 * 
 * @param date - ISO date string (YYYY-MM-DD)
 * @param venue - Venue code (e.g., "ST", "HV")
 * @param raceNo - Race number
 * @param mtpBucket - Minutes to post bucket (15 or 30)
 * @returns Array of odds records
 */
export async function fetchHistoricalOdds(
  date: string,
  venue: string,
  raceNo: number,
  mtpBucket: 15 | 30
): Promise<Array<{ runner_number: string; odds: string }>> {
  const sql = getDb()
  
  try {
    const rows = await sql`
      SELECT runner_number, odds
      FROM odds_snapshots
      WHERE date = ${date}
        AND venue = ${venue.toUpperCase()}
        AND race_no = ${raceNo}
        AND mtp_bucket = ${mtpBucket}
      LIMIT 20
    `
    return rows as Array<{ runner_number: string; odds: string }>
  } catch (error) {
    console.error(`[DB] Failed to fetch ${mtpBucket}min odds:`, error instanceof Error ? error.message : String(error))
    return []
  }
}

/**
 * Batch fetch historical odds for multiple MTP buckets.
 * Uses Promise.all for parallel execution.
 * 
 * @param date - ISO date string (YYYY-MM-DD)
 * @param venue - Venue code
 * @param raceNo - Race number
 * @returns Object with min15 and min30 odds
 */
export async function fetchAllHistoricalOdds(
  date: string,
  venue: string,
  raceNo: number
): Promise<{
  min15: Record<string, number>
  min30: Record<string, number>
}> {
  const [min15Rows, min30Rows] = await Promise.all([
    fetchHistoricalOdds(date, venue, raceNo, 15),
    fetchHistoricalOdds(date, venue, raceNo, 30)
  ])

  const min15Map: Record<string, number> = {}
  const min30Map: Record<string, number> = {}

  min15Rows.forEach(row => {
    const runnerNum = String(row.runner_number).padStart(2, '0')
    const odds = parseFloat(row.odds)
    if (!isNaN(odds)) {
      min15Map[runnerNum] = odds
    }
  })

  min30Rows.forEach(row => {
    const runnerNum = String(row.runner_number).padStart(2, '0')
    const odds = parseFloat(row.odds)
    if (!isNaN(odds)) {
      min30Map[runnerNum] = odds
    }
  })

  return { min15: min15Map, min30: min30Map }
}
