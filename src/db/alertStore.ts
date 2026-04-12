// src/db/alertStore.ts
import { neon } from "@neondatabase/serverless"

export interface AlertHistoryParams {
  limit?: number
  severity?: string
  date?: string
}

export async function getAlertHistory(params: AlertHistoryParams) {
  if (!process.env.DATABASE_URL) return []

  const sql = neon(process.env.DATABASE_URL)
  const limit = params.limit ?? 30
  
  try {
    let query
    
    if (params.date && params.severity) {
      query = await sql`
        SELECT * FROM alerts 
        WHERE date = ${params.date}::date AND severity = ${params.severity}
        ORDER BY detected_at DESC 
        LIMIT ${limit}
      `
    } else if (params.date) {
      query = await sql`
        SELECT * FROM alerts 
        WHERE date = ${params.date}::date
        ORDER BY detected_at DESC 
        LIMIT ${limit}
      `
    } else if (params.severity) {
      query = await sql`
        SELECT * FROM alerts 
        WHERE severity = ${params.severity}
        ORDER BY detected_at DESC 
        LIMIT ${limit}
      `
    } else {
      query = await sql`
        SELECT * FROM alerts 
        ORDER BY detected_at DESC 
        LIMIT ${limit}
      `
    }
    
    return query
  } catch (error) {
    console.error("Failed to fetch alert history:", error)
    return []
  }
}

export async function getTodayAlertStats() {
  if (!process.env.DATABASE_URL) return { critical: 0, high: 0, medium: 0, total: 0 }

  const sql = neon(process.env.DATABASE_URL)
  
  try {
    const stats = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL') as critical,
        COUNT(*) FILTER (WHERE severity = 'HIGH') as high,
        COUNT(*) FILTER (WHERE severity = 'MEDIUM') as medium
      FROM alerts 
      WHERE date = CURRENT_DATE
    `
    
    if (stats.length > 0) {
      return {
        total: Number(stats[0].total),
        critical: Number(stats[0].critical),
        high: Number(stats[0].high),
        medium: Number(stats[0].medium)
      }
    }
    
    return { critical: 0, high: 0, medium: 0, total: 0 }
  } catch (error) {
    console.error("Failed to fetch today alert stats:", error)
    return { critical: 0, high: 0, medium: 0, total: 0 }
  }
}