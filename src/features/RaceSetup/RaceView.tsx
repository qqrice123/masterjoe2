import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { api, RaceDetail, Prediction } from "@/services/api";
import { EVBadge } from "@/shared/EVBadge";
import { GradeBadge } from "@/shared/GradeBadge";
import { AlertBadge } from "@/shared/AlertBadge";
import { MoneyFlowChart } from "../MoneyFlow/MoneyFlowChart";
import { PaceDrawMap } from "../AnalyticsDashboard/PaceDrawMap";
import { PoolSummary } from "../AnalyticsDashboard/PoolSummary";
import { Recommendations } from "../Recommendations/Recommendations";

const COMBAT_COLORS: Record<string, string> = {
  GO:      "text-emerald-400",
  SHADOW:  "text-yellow-400",
  CAUTION: "text-orange-400",
  AVOID:   "text-red-400",
};

function formatMillion(n: number | undefined) {
  if (!n) return "—";
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M`
       : n >= 1000 ? `$${(n / 1000).toFixed(0)}K`
       : `$${n.toFixed(0)}`;
}

function AlertCell({ p }: { p: Prediction }) {
  const tags: string[] = [];
  if (p.investmentLabel === "BEST") tags.push("🔥首選");
  if (p.investmentLabel === "DARKHORSE") tags.push("⚡黑馬");
  if (p.investmentLabel === "RISK") tags.push("⚠️風險");
  if (p.combatStatus === "GO") tags.push("✅出擊");
  if (p.combatStatus === "AVOID") tags.push("❌迴避");
  const hist = p.oddsHistory;
  if (hist) {
    const overnight = parseFloat(String(hist.overnight));
    const current   = parseFloat(String(hist.current));
    if (!isNaN(overnight) && !isNaN(current)) {
      const drop = (overnight - current) / overnight;
      if (drop >= 0.30) tags.push("🐋大戶落飛");
      else if (drop <= -0.20) tags.push("📉資金撤離");
    }
  }
  if (p.riskFactors?.length) tags.push("⚠️" + p.riskFactors[0]);
  return (
    <div className="flex flex-wrap gap-1 min-w-[100px]">
      {tags.length ? tags.map(t => (
        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-200 whitespace-nowrap">{t}</span>
      )) : <span className="text-slate-500 text-xs">—</span>}
    </div>
  );
}

export function RaceView() {
  const [, params] = useRoute<{ venue: string; raceNo: string }>("/race/:venue/:raceNo");
  const venue = params?.venue || "";
  const raceNo = params?.raceNo || "";

  const { data: race, isLoading } = useQuery<RaceDetail>({
    queryKey: ["race", venue, raceNo],
    queryFn: () => api.getRaceDetail(venue, parseInt(raceNo, 10)),
    enabled: !!venue && !!raceNo,
    refetchInterval: 30_000,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 gap-3">
      <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"/>
      分析中…
    </div>
  );
  if (!race) return <div className="text-slate-400 p-8 text-center">找不到賽事資料</div>;

  const preds = race.predictions ?? [];

  return (
    <div className="space-y-5 pb-24">

      {/* ── 賽事標題 ── */}
      <div className="bg-[#161b27] rounded-xl p-4 border border-[#2a3352]">
        <h1 className="text-lg font-bold text-white mb-1">{race.raceName}</h1>
        <div className="flex flex-wrap gap-2 text-xs text-slate-400">
          <span className="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">R{race.raceNumber}</span>
          <span>{race.distance}米</span>
          <span>{race.track}</span>
          <span>{race.going}</span>
          <span>{race.raceClass}</span>
          <span className="ml-auto text-slate-500">{race.postTime}</span>
        </div>
        {/* 置信度 */}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-slate-500">系統置信度：</span>
          <span className={`text-xs font-bold ${race.confidence === "HIGH" ? "text-emerald-400" : race.confidence === "MEDIUM" ? "text-yellow-400" : "text-red-400"}`}>
            {race.confidence === "HIGH" ? "🟢 高" : race.confidence === "MEDIUM" ? "🟡 中" : "🔴 低"}
          </span>
        </div>
      </div>

      {/* ── 彩池總額跑馬燈 ── */}
      {race.pools && <PoolSummary pools={race.pools} />}

      {/* ── EV Matrix Table ── */}
      <div className="bg-[#161b27] rounded-xl border border-[#2a3352] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a3352] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">📊 EV 分析矩陣</h2>
          <span className="text-xs text-slate-500">{preds.length} 匹</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="text-slate-400 bg-[#1c2333] text-left">
                {["#","馬名","評級","狀態","系統勝率","即時賠率","推算投注額","QIN聚合","EV值","時間差(s)","⚠️警報"].map(h => (
                  <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preds.map((p: Prediction, i: number) => (
                <tr key={p.runnerNumber}
                  className={`border-t border-[#2a3352] hover:bg-[#1c2333]/60 transition-colors ${i === 0 ? "bg-blue-500/5" : ""}`}>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold">{p.runnerNumber}</span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[160px]">
                    <div className="font-medium text-slate-200 truncate">{p.runnerName}</div>
                    <div className="text-slate-500 truncate">{p.jockey} / {p.trainer}</div>
                  </td>
                  <td className="px-3 py-2.5"><GradeBadge grade={p.grade} /></td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs ${COMBAT_COLORS[p.combatStatus ?? ""] ?? "text-slate-400"}`}>
                      {p.conditionLabel ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono font-bold text-slate-200">{p.winProbability}%</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-white">{p.winOdds}</span>
                    {p.oddsHistory && (
                      <div className="text-[10px] text-slate-500">
                        夜 {p.oddsHistory.overnight} → 前30 {p.oddsHistory.min30}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-emerald-400">
                    {formatMillion(p.estWinInvestment)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-blue-400">
                    {formatMillion(p.estQINInvestment)}
                  </td>
                  <td className="px-3 py-2.5">
                    <EVBadge ev={p.expectedValue} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`font-mono ${p.timeAdvantage < 0 ? "text-emerald-400" : p.timeAdvantage > 0.3 ? "text-red-400" : "text-slate-300"}`}>
                      {p.timeAdvantage > 0 ? "+" : ""}{p.timeAdvantage}
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><AlertCell p={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 步速 + 檔位圖 ── */}
      {preds.length > 0 && <PaceDrawMap predictions={preds} totalRunners={preds.length} />}

      {/* ── 賠率走勢圖 ── */}
      {preds.some(p => p.oddsHistory) && <MoneyFlowChart predictions={preds} />}

      {/* ── AI 建議 ── */}
      <Recommendations race={race} />

    </div>
  );
}
