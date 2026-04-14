import { useQuery } from "@tanstack/react-query"
import { api, RaceDetail } from "../../services/api"
import { useMemo } from "react"

export function SmartMoneyBoard({ venueCode, totalRaces }: { venueCode: string; totalRaces: number }) {
  const { data: allRaces, isLoading } = useQuery<RaceDetail[]>({
    queryKey: ["all-races", venueCode, totalRaces],
    queryFn: async () => {
      // 避免被馬會 API 阻擋，我們循序抓取或平行抓取
      const promises = []
      for (let i = 1; i <= totalRaces; i++) {
        promises.push(api.getRaceDetail(venueCode, i).catch(() => null))
      }
      const results = await Promise.all(promises)
      return results.filter(Boolean) as RaceDetail[]
    },
    enabled: !!venueCode && totalRaces > 0,
    staleTime: 60_000, // 快取 1 分鐘
  })

  const smartMoneyPicks = useMemo(() => {
    if (!allRaces) return []
    return allRaces.map(race => {
      let bestRunner: string | number | null = null
      let maxRatio = 0
      let horseName = ""
      let odds = ""
      
      const preds = race.predictions || []
      preds.forEach(p => {
        if (String(p.runnerNumber).startsWith("R")) return
        const win = p.estWinInvestment ?? 0
        const qin = p.estQINInvestment ?? 0
        const qpl = p.estQPLInvestment ?? 0

        if (win > 0 && (win + qin + qpl) > 5000) {
          const ratio = (qin + qpl) / win
          if (ratio > maxRatio) {
            maxRatio = ratio
            bestRunner = p.runnerNumber
            horseName = p.runnerName
            odds = String(p.winOdds)
          }
        }
      })
      
      return {
        raceNo: race.raceNumber,
        raceName: race.raceName,
        runnerNumber: bestRunner,
        horseName,
        odds,
        ratio: maxRatio
      }
    })
  }, [allRaces])

  if (!venueCode) return null

  return (
    <div className="bg-[#0d1421] border border-slate-700/50 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full bg-[#7dd3fc]" />
        <h3 className="text-sm font-bold text-slate-200">今日聰明錢總覽榜 (QIN/QPL 異常資金)</h3>
      </div>
      
      {isLoading ? (
        <div className="text-xs text-slate-500 py-4 text-center animate-pulse">掃描全日賽事資金中...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {smartMoneyPicks.map((pick) => (
            <div key={pick.raceNo} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 flex flex-col justify-center">
              <div className="text-[10px] text-slate-500 mb-1">第 {pick.raceNo} 場</div>
              {pick.runnerNumber ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#7dd3fc]/20 text-[#7dd3fc] font-bold text-xs">
                      {pick.runnerNumber}
                    </span>
                    <span className="font-bold text-slate-200 text-sm truncate">{pick.horseName}</span>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[10px] text-slate-400">異常倍數: <span className="text-[#7dd3fc] font-bold">{pick.ratio.toFixed(1)}x</span></span>
                    <span className="text-[10px] font-mono text-white">{pick.odds}</span>
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-600 mt-1">資金尚未成型</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
