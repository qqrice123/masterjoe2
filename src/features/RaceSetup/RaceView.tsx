// src/components/features/RaceView/RaceView.tsx
// FIX: (p as any) removed; WeightRD + timeAdvantage fully typed; prev3min used

import { useQuery }          from "@tanstack/react-query"
import { useRoute }          from "wouter"
import { api, RaceDetail, Prediction } from "../../services/api"
import { getWeightRDTooltip }           from "../../services/weightRD.utils"
import { MoneyFlowChart }    from "../MoneyFlow/MoneyFlowChart"
import { PaceDrawMap }       from "../AnalyticsDashboard/PaceDrawMap"
import { PoolSummary }       from "../AnalyticsDashboard/PoolSummary"
import { Recommendations }   from "../Recommendations/Recommendations"

const COMBAT_COLORS: Record<string, string> = {
  GO: "text-emerald-400", SHADOW: "text-yellow-400",
  CAUTION: "text-orange-400", AVOID: "text-red-400",
}

function formatMillion(n: number | undefined | null): string {
  if (!n) return "—"
  return n >= 1_000_000 ? `${(n/1_000_000).toFixed(2)}M`
       : n >= 1_000     ? `${(n/1_000).toFixed(0)}K`
       : n.toFixed(0)
}

// FIX: typed — no (p as any)
function WeightRDBadge({ p }: { p: Prediction }) {
  const tip = p.weightRD != null && p.weightRDBenchmark != null
    ? getWeightRDTooltip({ weightRD: p.weightRD, weightRDBenchmark: p.weightRDBenchmark,
        isGoldenWeightRD: p.isGoldenWeightRD??false, goldenScore: p.goldenScore??0,
        isStrongStar: p.isStrongStar??false, isBlueStar: p.isBlueStar??false })
    : `WeightRD 命中 (${p.goldenScore?.toFixed(1)}%)`
  if (p.isGoldenWeightRD) return <span className="text-emerald-400 text-xs" title={tip}>✨</span>
  if (p.isStrongStar)     return <span className="text-yellow-400 text-xs" title={tip}>★</span>
  if (p.isBlueStar)       return <span className="text-blue-400 text-xs" title="監察信號 10-19.9x">★</span>
  return null
}

function AlertCell({ p }: { p: Prediction }) {
  const tags: string[] = []
  if (p.investmentLabel === "BEST")      tags.push("💎 最佳")
  if (p.investmentLabel === "DARKHORSE") tags.push("🌑 黑馬")
  if (p.investmentLabel === "RISK")      tags.push("⚠ 風險")
  if (p.combatStatus    === "GO")        tags.push("🟢 GO")
  if (p.combatStatus    === "AVOID")     tags.push("🚫 避")
  const hist = p.oddsHistory
  if (hist) {
    const ov = parseFloat(String(hist.overnight))
    const cu = parseFloat(String(hist.current))
    if (!isNaN(ov) && !isNaN(cu)) {
      const d = (ov - cu) / ov
      if (d > 0.20) tags.push("📉 大縮水")
      else if (d < -0.20) tags.push("📈 大飄升")
    }
  }
  if (p.riskFactors?.length) tags.push(p.riskFactors[0])
  return (
    <div className="flex flex-wrap gap-1 min-w-[100px]">
      {tags.length
        ? tags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-200 whitespace-nowrap">{t}</span>)
        : <span className="text-slate-500 text-xs">—</span>}
    </div>
  )
}

export function RaceView() {
  const [, params] = useRoute<{ venue: string; raceNo: string }>("/:venue/:raceNo")
  const { data: race, isLoading } = useQuery<RaceDetail>({
    queryKey: ["race", params?.venue, params?.raceNo],
    queryFn:  () => api.getRaceDetail(params!.venue, parseInt(params!.raceNo, 10)),
    enabled:  !!params?.venue && !!params?.raceNo,
    refetchInterval: 30_000,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 gap-3">
      <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      載入中…
    </div>
  )
  if (!race) return <div className="text-slate-400 p-8 text-center">找不到賽事資料</div>

  const preds = race.predictions ?? []
  const headers = ["#","馬匹","級","狀態","勝率","賠率","WIN","QIN","QPL","EV","時差","備註"]

  return (
    <div className="space-y-5 pb-24">
      {/* Race header */}
      <div className="bg-[#161b27] rounded-xl p-4 border border-[#2a3352]">
        <h1 className="text-lg font-bold text-white mb-1">{race.raceName}</h1>
        <div className="flex flex-wrap gap-2 text-xs text-slate-400">
          <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">R{race.raceNumber}</span>
          <span>{race.distance}m</span><span>{race.track}</span>
          <span>{race.going}</span><span>{race.raceClass}</span>
          <span className="ml-auto text-slate-500">{race.postTime}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-slate-500">信心:</span>
          <span className={`text-xs font-bold ${race.confidence==="HIGH"?"text-emerald-400":race.confidence==="MEDIUM"?"text-yellow-400":"text-red-400"}`}>
            {race.confidence==="HIGH"?"🟢 高":race.confidence==="MEDIUM"?"🟡 中":"🔴 低"}
          </span>
        </div>
      </div>

      {race.pools && <PoolSummary pools={race.pools}  />}

      {/* EV Matrix */}
      <div className="bg-[#161b27] rounded-xl border border-[#2a3352] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a3352] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">📊 EV 矩陣</h2>
          <span className="text-xs text-slate-500">{preds.length} 匹</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="text-slate-400 bg-[#1c2333] text-left">
                {headers.map(h => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {preds.map((p: Prediction, i: number) => {
                // FIX: prev3min used; no (p as any)
                const refOdds = p.oddsHistory?.prev3min ?? p.oddsHistory?.min30
                return (
                  <tr key={p.runnerNumber}
                    className={`border-t border-[#2a3352] hover:bg-[#1c2333]/60 transition-colors ${i===0?"bg-blue-500/5":""}`}>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold">{p.runnerNumber}</span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[160px]">
                      <div className="font-medium text-slate-200 truncate flex items-center gap-1">
                        {p.runnerName}
                        {/* FIX: typed WeightRD badge */}
                        <WeightRDBadge p={p} />
                      </div>
                      <div className="text-slate-500 truncate">{p.jockey} / {p.trainer}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`w-6 h-6 inline-flex items-center justify-center rounded-full text-xs font-bold
                        ${p.grade==="A"?"bg-emerald-800 text-emerald-200":p.grade==="B"?"bg-blue-800 text-blue-200":p.grade==="C"?"bg-amber-800 text-amber-200":"bg-slate-700 text-slate-400"}`}>
                        {p.grade}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs ${COMBAT_COLORS[p.combatStatus]??"text-slate-400"}`}>{p.conditionLabel??"—"}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-200">{p.winProbability}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-white">{p.winOdds}</span>
                      {refOdds!=null && <div className="text-[10px] text-slate-500">3′{refOdds}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[#fff005]">{formatMillion(p.estWinInvestment)}</td>
                    <td className="px-3 py-2.5 font-mono text-[#ff9205]">{formatMillion(p.estQINInvestment)}</td>
                    <td className="px-3 py-2.5 font-mono text-[#f953f7]">{formatMillion(p.estQPLInvestment)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-mono font-bold ${p.expectedValue>0.1?"text-emerald-400":p.expectedValue>0?"text-amber-400":"text-red-400"}`}>
                        {p.expectedValue>0?"+":""}{(p.expectedValue*100).toFixed(0)}%
                      </span>
                    </td>
                    {/* FIX: timeAdvantage typed — no (p as any) */}
                    <td className="px-3 py-2.5">
                      {p.timeAdvantage!=null
                        ? <span className={`font-mono ${p.timeAdvantage>0?"text-emerald-400":p.timeAdvantage<-0.3?"text-red-400":"text-slate-300"}`}>
                            {p.timeAdvantage>0?"+":""}{p.timeAdvantage.toFixed(2)}s
                          </span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5"><AlertCell p={p} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {preds.length > 0 && <PaceDrawMap predictions={preds} totalRunners={preds.length} />}
      {preds.some(p => p.oddsHistory) && <MoneyFlowChart predictions={preds} />}
      <Recommendations race={race} />
    </div>
  )
}
