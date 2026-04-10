import { Prediction } from "@/services/api";

interface Props { predictions: Prediction[]; totalRunners: number; }

type PaceType = "fast" | "normal" | "slow";
const PACE_LABEL: Record<PaceType, { label: string; color: string; emoji: string }> = {
  fast:   { label: "快節奏", color: "text-red-400",    emoji: "⚡" },
  normal: { label: "正常",   color: "text-yellow-400", emoji: "🟡" },
  slow:   { label: "慢節奏", color: "text-blue-400",   emoji: "🐌" },
};

function predictPace(preds: Prediction[]) {
  const leaders   = preds.filter(p => p.combatAdvice?.includes("領")).length;
  const prominent = preds.filter(p => p.combatAdvice?.includes("跟")).length;
  const ratio = (leaders + prominent) / preds.length;
  const pace: PaceType = leaders >= 4 || ratio > 0.6 ? "fast" : leaders <= 1 && ratio < 0.3 ? "slow" : "normal";
  return { pace, leaderCount: leaders, frontRatio: ratio };
}

function getDrawGroup(draw: number, total: number) {
  const inner = Math.ceil(total * 0.3);
  const outer = Math.floor(total * 0.7);
  if (draw <= inner) return "inner";
  if (draw >= outer) return "outer";
  return "mid";
}

export function PaceDrawMap({ predictions, totalRunners }: Props) {
  const { pace, leaderCount, frontRatio } = predictPace(predictions);
  const info = PACE_LABEL[pace];

  const groups = {
    leader:     predictions.filter(p => p.combatAdvice?.includes("領") || p.combatStatus === "GO"),
    prominent:  predictions.filter(p => p.combatAdvice?.includes("跟前")),
    midfield:   predictions.filter(p => p.combatAdvice?.includes("中置")),
    rear:       predictions.filter(p => p.combatAdvice?.includes("後追")),
  };

  const HorseTag = ({ p, highlight }: { p: Prediction; highlight?: boolean }) => (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs transition-all
      ${highlight ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-[#2a3352] bg-[#1c2333] text-slate-300"}`}>
      <span className="font-bold text-slate-400">{p.draw || p.runnerNumber}</span>
      <span className="truncate max-w-[60px]">{p.runnerName.split("").slice(0,4).join("")}</span>
      <span className={`${highlight ? "text-emerald-400" : "text-slate-500"}`}>
        {p.expectedValue > 0.1 ? "🟢" : p.expectedValue > 0 ? "🟡" : "🔴"}
      </span>
    </div>
  );

  return (
    <div className="bg-[#161b27] rounded-xl border border-[#2a3352] p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-200">🏁 步速 + 檔位分析</h2>
        <div className="flex gap-3 text-xs">
          <span className={info.color}>{info.emoji} {info.label}</span>
          <span className="text-slate-500">領放 {leaderCount} 匹 · 前位率 {(frontRatio*100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 跑法分組 */}
        <div className="space-y-3">
          {[
            { label: "🏇 領放區",  horses: groups.leader,    hint: "爭奪主控" },
            { label: "⚡ 跟前區",  horses: groups.prominent, hint: "貼近馬頭" },
            { label: "🎯 中置區",  horses: groups.midfield,  hint: "靜待時機" },
            { label: "🚀 後追區",  horses: groups.rear,      hint: "衝刺型" },
          ].map(({ label, horses, hint }) => (
            <div key={label} className="bg-[#1c2333] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-300">{label}</span>
                <span className="text-xs text-slate-500">{hint}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {horses.length ? horses.map(p => (
                  <HorseTag key={p.runnerNumber} p={p} highlight={p.expectedValue > 0} />
                )) : <span className="text-slate-600 text-xs">—</span>}
              </div>
            </div>
          ))}
        </div>

        {/* 檔位視覺化 */}
        <div className="bg-[#1c2333] rounded-lg p-3">
          <div className="text-xs font-medium text-slate-300 mb-3">📍 檔位分佈（內→外）</div>
          <div className="space-y-1.5">
            {predictions
              .sort((a, b) => (a.draw || a.runnerNumber) - (b.draw || b.runnerNumber))
              .map(p => {
                const group = getDrawGroup(p.draw || p.runnerNumber, totalRunners);
                const isEdge = group === "inner" && p.expectedValue > 0.1;
                return (
                  <div key={p.runnerNumber} className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs w-4">{p.draw || p.runnerNumber}</span>
                    <div className={`h-5 rounded transition-all flex items-center px-2
                      ${group === "inner" ? "bg-blue-500/20" : group === "outer" ? "bg-purple-500/20" : "bg-slate-700/50"}`}
                      style={{ width: `${((p.draw || p.runnerNumber) / totalRunners) * 100}%`, minWidth: "60px" }}>
                      <span className={`text-[10px] truncate ${isEdge ? "text-emerald-400 font-bold" : "text-slate-400"}`}>
                        {p.runnerName.slice(0,4)} {isEdge ? "✓" : ""}
                      </span>
                    </div>
                    <span className={`text-[10px] ${group === "inner" ? "text-blue-400" : group === "outer" ? "text-purple-400" : "text-slate-500"}`}>
                      {group === "inner" ? "內" : group === "outer" ? "外" : "中"}
                    </span>
                  </div>
                );
              })}
          </div>
          <div className="flex gap-3 mt-3 text-[10px] text-slate-500">
            <span className="text-blue-400">■ 內檔</span>
            <span className="text-slate-400">■ 中檔</span>
            <span className="text-purple-400">■ 外檔</span>
          </div>
        </div>
      </div>
    </div>
  );
}
