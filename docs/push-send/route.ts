// app/api/alerts/route.ts
import { getAlertHistory, getTodayAlertStats } from "@/db/alertStore"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit    = Math.min(Number(searchParams.get("limit") ?? 30), 100)
  const severity = searchParams.get("severity") ?? undefined
  const date     = searchParams.get("date")     ?? undefined

  const [history, stats] = await Promise.all([
    getAlertHistory({ limit, severity, date }),
    getTodayAlertStats(),
  ])
  return Response.json({ history, stats }, {
    headers: { "Cache-Control": "no-store" }
  })
}
