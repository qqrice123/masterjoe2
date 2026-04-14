import { useQuery } from "@tanstack/react-query"
import { api, RaceDetail } from "../../services/api"
import { useMemo } from "react"

export function SmartMoneyHistory({ raceDetail }: { raceDetail: RaceDetail }) {
  const { data, isLoading } = useQuery({
    queryKey: ["alerts", raceDetail.venueCode, raceDetail.raceNumber, "SMART_MONEY"],
    queryFn: async () => {
      // 取得今天的日期 (YYYY-MM-DD)
      const today = new Date().toISOString().split('T')[0]
      return api.getAlerts(100, undefined, today, "SMART_MONEY", raceDetail.venueCode, raceDetail.raceNumber)
    },
    enabled: !!raceDetail.venueCode && !!raceDetail.raceNumber,
    refetchInterval: 60_000, // 每分鐘更新
  })

  const history = data?.history || []

  // 統計每個馬匹的駐留時間 (每次 cron 抓取代表約 5 分鐘)
  const stats = useMemo(() => {
    if (!history.length) return []
    
    const counts: Record<string, { name: string; count: number }> = {}
    history.forEach((alert: any) => {
      const num = alert.runner_number
      if (!counts[num]) {
        counts[num] = { name: alert.runner_name, count: 0 }
      }
      counts[num].count += 1
    })

    return Object.entries(counts)
      .map(([num, data]) => ({
        runnerNumber: num,
        runnerName: data.name,
        count: data.count,
        minutes: data.count * 5 // 每次記錄約為 5 分鐘區間
      }))
      .sort((a, b) => b.count - a.count)
  }, [history])

  if (isLoading) {
    return <div className="text-xs text-slate-500 py-2 animate-pulse">讀取歷史駐留時間...</div>
  }

  if (stats.length === 0) {
    return null
  }

  return (
    <div className="bg-[#1c2333]/50 rounded-xl p-3 border border-[#2a3352] mt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-[#7dd3fc]" />
        <h4 className="text-xs font-semibold text-slate-300">開跑前聰明錢 (藍點) 歷史駐留統計</h4>
      </div>
      <div className="flex flex-wrap gap-2">
        {stats.map((stat, i) => (
          <div key={stat.runnerNumber} className="flex items-center bg-[#0d1421] border border-slate-700/50 rounded px-2 py-1 gap-2">
            <div className={`text-xs font-bold ${i === 0 ? 'text-[#7dd3fc]' : 'text-slate-400'}`}>
              {stat.runnerNumber} {stat.runnerName}
            </div>
            <div className="text-[10px] text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded">
              {stat.minutes} 分鐘 <span className="text-slate-600">({stat.count}次)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
