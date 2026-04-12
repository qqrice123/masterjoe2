// src/features/AnalyticsDashboard/OddsStructureBanner.tsx
// Displays race type classification (馬膽局 / 分立局 / 混亂局) derived from API oddsStructure

interface OddsStructure {
  raceType: "馬膽局" | "分立局" | "混亂局" | "未能判斷"
  raceTypeCode: "BANKER" | "SPLIT" | "CHAOTIC" | "UNKNOWN"
  od1: number
  od2: number
  od3: number
  od4: number
  od1Name?: string
  od2Name?: string
  od3Name?: string
  od4Name?: string
  od1Count?: number
  od2Count?: number
  od3Count?: number
  oddsPattern?: string
  hotCount: number
  coldSignal: boolean
  qinFocus: "od1_group" | "od2_od3_group" | "spread" | "unknown"
  topBanker: string | null
  coldCandidates: (string | number)[]
  description: string
  tip: string
}

interface Props {
  oddsStructure: OddsStructure | null | undefined
  isPreRace?: boolean
}

const CONFIG = {
  BANKER: {
    label: "馬膽局",
    labelEn: "BANKER RACE",
    bg: "bg-emerald-950/60",
    border: "border-emerald-700/50",
    badge: "bg-emerald-600 text-white",
    dot: "bg-emerald-400",
    tipColor: "text-emerald-300",
    icon: "🏆",
  },
  SPLIT: {
    label: "分立局",
    labelEn: "SPLIT RACE",
    bg: "bg-blue-950/60",
    border: "border-blue-700/50",
    badge: "bg-blue-600 text-white",
    dot: "bg-blue-400",
    tipColor: "text-blue-300",
    icon: "⚖️",
  },
  CHAOTIC: {
    label: "混亂局",
    labelEn: "CHAOTIC RACE",
    bg: "bg-red-950/60",
    border: "border-red-700/50",
    badge: "bg-red-600 text-white",
    dot: "bg-red-400 animate-pulse",
    tipColor: "text-red-300",
    icon: "🌪️",
  },
  UNKNOWN: {
    label: "未能判斷",
    labelEn: "UNKNOWN",
    bg: "bg-slate-900/60",
    border: "border-slate-700/50",
    badge: "bg-slate-600 text-slate-300",
    dot: "bg-slate-500",
    tipColor: "text-slate-400",
    icon: "⏳",
  },
}

function OddsTag({ value, label, name }: { value: number; label: string; name?: string }) {
  const color =
    value <= 3
      ? "text-emerald-400 bg-emerald-950/70"
      : value <= 5.5
      ? "text-amber-400 bg-amber-950/70"
      : "text-slate-400 bg-slate-800/70"
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border border-white/5 ${color}`}>
      <span className="text-slate-500 font-sans">{label}</span>
      {name && <span className="text-slate-300 font-sans max-w-[60px] truncate" title={name}>{name}</span>}
      <span className="font-bold">{value}</span>
    </span>
  )
}

export function OddsStructureBanner({ oddsStructure, isPreRace }: Props) {
  if (!oddsStructure || oddsStructure.raceTypeCode === "UNKNOWN") {
    return (
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-500 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-base">⏳</span>
          {isPreRace ? "賠率未開盤 — 賽局結構分析將於開盤後顯示" : "賽駒資料不足，無法分析賽局結構"}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 bg-slate-800/40 px-2 py-1 rounded-full whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live Auto-Sync
        </div>
      </div>
    )
  }

  const cfg = CONFIG[oddsStructure.raceTypeCode]

  return (
    <div className={`relative rounded-xl border p-4 space-y-3 ${cfg.bg} ${cfg.border}`}>
      {/* Live Indicator */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 text-[10px] text-emerald-400/80 bg-emerald-950/40 border border-emerald-900/50 px-2 py-1 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        自動同步中
      </div>

      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3 pr-20">
        {/* Race type badge */}
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${cfg.badge}`}>
          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
          {cfg.icon} {oddsStructure.raceType}
        </span>

        {/* Odds tier pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <OddsTag value={oddsStructure.od1} label="大熱" name={oddsStructure.od1Name} />
          <OddsTag value={oddsStructure.od2} label="次熱" name={oddsStructure.od2Name} />
          <OddsTag value={oddsStructure.od3} label="三熱" name={oddsStructure.od3Name} />
          <OddsTag value={oddsStructure.od4} label="四熱" name={oddsStructure.od4Name} />
        </div>

        {/* Hot horse count */}
        <span className="text-xs text-slate-400 ml-auto">
          熱門馬（≤10）：
          <span className="text-slate-200 font-semibold ml-1">{oddsStructure.hotCount} 匹</span>
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-slate-300 leading-relaxed">{oddsStructure.description}</p>

      {/* Tip */}
      <div className={`flex items-start gap-2 text-sm ${cfg.tipColor}`}>
        <span className="mt-0.5 shrink-0">💡</span>
        <span>{oddsStructure.tip}</span>
      </div>

      {/* Cold candidates (only for CHAOTIC / cold SPLIT) */}
      {oddsStructure.coldSignal && oddsStructure.coldCandidates.length > 0 && (
        <div className="flex items-center gap-2 pt-1 border-t border-white/5">
          <span className="text-xs text-slate-500">冷門留意：</span>
          <div className="flex gap-1.5">
            {oddsStructure.coldCandidates.map((no) => (
              <span
                key={no}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-red-900/70 border border-red-600/50 text-red-300 text-xs font-bold"
              >
                {no}
              </span>
            ))}
          </div>
          <span className="text-xs text-slate-600 ml-1">（od₃–od₆ 範圍）</span>
        </div>
      )}

      {/* QIN focus indicator */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>連贏聚焦：</span>
        <span className="text-slate-300 font-medium">
          {oddsStructure.qinFocus === "od1_group" && "首選組合為主"}
          {oddsStructure.qinFocus === "od2_od3_group" && "次選 / 第三選冷馬組合"}
          {oddsStructure.qinFocus === "spread" && "分散注碼，寬覆蓋"}
          {oddsStructure.qinFocus === "unknown" && "—"}
        </span>
        {oddsStructure.topBanker && (
          <span className="text-slate-400">
            · 膽馬：
            <span className="text-emerald-400 font-bold ml-1">#{oddsStructure.topBanker}</span>
          </span>
        )}
      </div>
    </div>
  )
}
