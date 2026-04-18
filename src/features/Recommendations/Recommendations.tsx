import { RaceDetail, Prediction } from "@/services/api";

interface Props { race: RaceDetail }

const VERDICT_ICONS: Record<string, string> = {
  GO:      "✅",
  SHADOW:  "👁",
  CAUTION: "⚠️",
  AVOID:   "❌",
};

function RankCard({ rank, horse, label, color }: {
  rank: string; horse: Prediction; label: string; color: string; key?: string | number
}) {
  const hasNoOdds = horse.winOdds === "—" || horse.winOdds == null;

  return (
    <div className={`bg-[#1c2333] rounded-xl p-4 border ${color} space-y-2 ${hasNoOdds ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400">{rank}</span>
        <span className="text-xs">{VERDICT_ICONS[horse.combatStatus ?? ""] ?? "⚪"}</span>
      </div>
      <div>
        <span className="text-sm font-bold text-white">
          {horse.runnerNumber}號 {horse.runnerName}
        </span>
        {horse.finalPosition != null && (
          <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded ${
            Number(horse.finalPosition) >= 1 && Number(horse.finalPosition) <= 3 
              ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" 
              : "bg-slate-700/50 text-slate-400"
          }`}>
            第 {horse.finalPosition} 名
          </span>
        )}
        <span className="ml-2 text-xs text-slate-400">{horse.jockey}</span>
      </div>
      <div className="flex gap-3 text-xs">
        <span className="text-blue-400">勝率 {horse.winProbability}%</span>
        <span className="text-slate-300">賠率 {horse.winOdds}</span>
        <span className={horse.expectedValue > 0 ? "text-emerald-400" : "text-red-400"}>
          EV {horse.expectedValue > 0 ? "+" : ""}{horse.expectedValue?.toFixed(3) ?? "—"}
        </span>
      </div>
      {horse.combatAdvice && (
        <p className="text-xs text-slate-400 leading-relaxed border-t border-[#2a3352] pt-2">
          {horse.combatAdvice}
        </p>
      )}
      <div className="flex gap-2 flex-wrap">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{horse.conditionLabel}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{horse.ageStageLabel}</span>
        {horse.kellyFraction != null && horse.kellyFraction > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
            Kelly {(horse.kellyFraction * 100).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

export function Recommendations({ race }: Props) {
  const preds = race.predictions ?? [];
  const ranked = [...preds].sort((a, b) => (b.expectedValue || 0) - (a.expectedValue || 0));
  // Relaxed "Top Pick" criteria to EV >= -0.06
  const top3   = ranked.filter(p => (p.expectedValue || 0) >= -0.06).slice(0, 3);
  const risks  = ranked.filter(p => (p.expectedValue || 0) < -0.30).slice(0, 2);

  return (
    <div className="bg-[#161b27] rounded-xl border border-[#2a3352] p-4">
      <h2 className="text-sm font-semibold text-slate-200 mb-4">🤖 AI 投注建議</h2>

      {race.summary && (
        <div className="bg-[#1c2333] rounded-lg p-3 mb-4 text-xs text-slate-300 leading-relaxed border-l-2 border-blue-500">
          {race.summary}
        </div>
      )}

      {top3.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-slate-400 mb-2 font-medium">🏆 推薦馬匹（正 EV）</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {top3.map((p, i) => (
              <RankCard
                key={p.runnerNumber}
                rank={["🥇 首選","🥈 次選","🥉 三選"][i]}
                horse={p}
                label=""
                color={["border-yellow-500/40","border-slate-500/40","border-orange-500/40"][i]}
              />
            ))}
          </div>
        </div>
      )}

      {risks.length > 0 && (
        <div>
          <div className="text-xs text-slate-400 mb-2 font-medium">🚫 避開馬匹（過熱 / 負 EV）</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {risks.map(p => {
              const hasNoOdds = p.winOdds === "—" || p.winOdds == null;
              return (
              <div key={p.runnerNumber} className={`bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-xs ${hasNoOdds ? "opacity-40" : ""}`}>
                <span className="text-white font-bold">{p.runnerNumber}號 {p.runnerName}</span>
                <span className="ml-2 text-red-400">EV {p.expectedValue?.toFixed(3) ?? "—"}</span>
                {p.riskFactors?.map(r => (
                  <span key={r} className="ml-2 text-slate-500">{r}</span>
                ))}
              </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  );
}
