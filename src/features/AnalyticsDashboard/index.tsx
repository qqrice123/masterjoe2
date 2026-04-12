// src/features/AnalyticsDashboard/index.tsx

import { memo, useMemo, useState } from "react"
import { OddsStructureBanner } from "./OddsStructureBanner"
import { Prediction, RaceDetail, OddsStructure } from "../../services/api"
import { aiEngine } from "../../services/aiLearning"

interface Props {
  raceDetail: RaceDetail | null | undefined
  isLoading?: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined, isTheoretical?: boolean): string {
  if (n == null) return "—"
  const m = n / 1_000_000
  const prefix = isTheoretical ? "~" : ""
  if (m >= 1) return `${prefix}$${m.toFixed(2)}M`
  const k = n / 1000
  return `${prefix}$${k.toFixed(0)}K`
}

function EVBadge({ ev }: { ev: number | undefined | null }) {
  if (ev === undefined || ev === null || isNaN(ev)) {
    return <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-slate-700 text-slate-400">—</span>
  }
  if (ev > 0.1)
    return <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-emerald-600 text-white">+{ev.toFixed(2)}</span>
  if (ev > 0)
    return <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-amber-600 text-white">+{ev.toFixed(2)}</span>
  return <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-slate-700 text-slate-400">{ev.toFixed(2)}</span>
}

function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: "bg-emerald-600 text-white",
    B: "bg-blue-600 text-white",
    C: "bg-amber-600 text-white",
    D: "bg-slate-700 text-slate-400",
  }
  return (
    <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${colors[grade] ?? colors.D}`}>
      {grade}
    </span>
  )
}

function CombatBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    GO:      { label: "⭐ 投注",  cls: "bg-emerald-700 text-emerald-100" },
    CAUTION: { label: "⚠️ 試注",  cls: "bg-amber-800 text-amber-200" },
    SHADOW:  { label: "⚡ Q位",   cls: "bg-blue-800 text-blue-200" },
    AVOID:   { label: "✗ 避免",  cls: "bg-slate-800 text-slate-500" },
  }
  const { label, cls } = map[status] ?? map.AVOID
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>
}

function AlertBadge({ alert }: { alert?: string }) {
  if (!alert || alert === "steady") return null
  if (alert === "large_bet")
    return <span className="text-xs text-emerald-400 font-bold animate-pulse">🔥 大注</span>
  return <span className="text-xs text-red-400">📉 走冷</span>
}

function SkeletonTable() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 rounded bg-slate-800/60 animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  )
}

// ── Pool Summary ───────────────────────────────────────────────────────────

function PoolSummary({ pools, isPreRace }: { pools: RaceDetail["pools"]; isPreRace: boolean }) {
  const items = [
    { label: "獨贏 WIN",  val: pools?.WIN, color: pools?.WIN ? "text-[#fff005]" : "text-slate-500", icon: "🏆", note: isPreRace ? "預估 ~28M" : undefined },
    { label: "位置 PLA",  val: pools?.PLA, color: "text-[#05b0ff]", icon: "🥈", note: isPreRace ? "賽前" : undefined },
    { label: "連贏 QIN",  val: pools?.QIN, color: "text-[#ff9205]", icon: "🔗", note: isPreRace ? "預估 ~20M" : undefined },
    { label: "位置Q QPL", val: pools?.QPL, color: "text-[#f953f7]", icon: "🎯" },
    { label: "孖寶 DBL",  val: pools?.DBL, color: "text-cyan-400",  icon: "⛓️", note: "跨場次資金" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {items.map(({ label, val, color, icon, note }) => (
        <div key={label} className="flex items-center gap-3 bg-[#1c2333] rounded-xl p-3 border border-[#2a3352]">
          <div className="text-2xl w-10 text-center">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">{label}</span>
              {note && <span className="text-xs text-slate-600">{note}</span>}
            </div>
            <div className={`text-lg font-bold font-mono ${color}`}>
              {val && val > 0 ? `HK$${(val >= 1_000_000 ? (val / 1_000_000).toFixed(2) + 'M' : val >= 1_000 ? (val / 1_000).toFixed(0) + 'K' : val)}` : "—"}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main EV Matrix Table ───────────────────────────────────────────────────

function AIFeedbackPanel({ predictions, oddsStructure }: { predictions: Prediction[]; oddsStructure?: OddsStructure }) {
  const [winner, setWinner] = useState<string>("");
  const [hasTrained, setHasTrained] = useState(false);

  const handleTrain = () => {
    if (!winner) return;
    aiEngine.feedbackResult(predictions, oddsStructure, winner);
    setHasTrained(true);
    setTimeout(() => setHasTrained(false), 3000);
  };

  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="text-xl hidden sm:block">🧠</div>
        <div>
          <h4 className="text-sm font-bold text-slate-200">AI 模型動態學習</h4>
          <p className="text-xs text-slate-400">輸入賽果，讓系統自動修正特徵權重</p>
        </div>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <select 
          className="bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-lg pl-3 pr-10 py-1.5 outline-none cursor-pointer appearance-none bg-no-repeat flex-1 sm:flex-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9' /%3E%3C/svg%3E")`,
            backgroundPosition: "right 0.5rem center",
            backgroundSize: "1.5em 1.5em"
          }}
          value={winner}
          onChange={e => setWinner(e.target.value)}
        >
          <option value="">選擇頭馬...</option>
          {predictions.filter(p => !String(p.runnerNumber).startsWith("R")).map(p => (
            <option key={p.runnerNumber} value={p.runnerNumber}>
              {p.runnerNumber} - {p.runnerName}
            </option>
          ))}
        </select>
        <button 
          onClick={handleTrain}
          disabled={!winner || hasTrained}
          className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${
            hasTrained ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          }`}
        >
          {hasTrained ? "完成 ✅" : "提交賽果"}
        </button>
      </div>
    </div>
  );
}

function EVMatrixTable({ predictions, isPreRace, oddsStructure }: { predictions: Prediction[]; isPreRace: boolean; oddsStructure?: OddsStructure }) {
  const systemTopPick = useMemo(() => {
    return aiEngine.getTopPick(predictions, oddsStructure);
  }, [predictions, oddsStructure]);

  if (!predictions?.length) return null

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/50">
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="bg-slate-900/80 border-b border-slate-700/50">
            {["#", "馬名", "評級", "狀態", "系統勝率", "即時賠率", "推算投注額", "QIN聚合", "QPL聚合", "EV值", "建議", "⚠️"].map(
              (h) => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 whitespace-nowrap">
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {predictions.map((p, i) => {
            const isReserve = String(p.runnerNumber).startsWith("R")
            const isSystemTopPick = p.runnerNumber === systemTopPick;

            return (
              <tr
                key={p.runnerNumber}
                className={`border-b border-slate-800/50 transition-colors hover:bg-slate-800/30
                  ${i === 0 ? "bg-slate-800/20" : ""}
                  ${isReserve ? "opacity-40" : ""}
                  ${p.combatStatus === "GO" ? "border-l-2 border-l-emerald-500" : ""}
                  ${p.combatStatus === "CAUTION" ? "border-l-2 border-l-amber-500" : ""}
                `}
              >
                {/* # */}
                <td className="px-3 py-3 font-mono font-bold text-slate-300 whitespace-nowrap relative">
                  {isSystemTopPick && (
                    <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#7dd3fc]" title="AI 系統首選"></span>
                  )}
                  <span className={isSystemTopPick ? "ml-2" : ""}>
                    {p.runnerNumber}
                  </span>
                  {p.draw > 0 && (
                    <span className="ml-1 text-xs text-slate-500">({p.draw})</span>
                  )}
                </td>

                {/* 馬名 */}
                <td className="px-3 py-3">
                  <div className="font-medium text-slate-200 flex items-center gap-1.5">
                    {p.runnerName}
                    {(p as any).isStrongStar && (
                      <span className="text-yellow-400 text-xs" title="強勢星星指標 (勝率換算<10 且 即時賠率<10)">★</span>
                    )}
                    {(p as any).isBlueStar && (
                      <span className="text-blue-400 text-xs" title="混亂局藍星指標 (系統勝率頭4 且 即時賠率10-19.9)">★</span>
                    )}
                    {isSystemTopPick && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#7dd3fc]/20 text-[#7dd3fc] border border-[#7dd3fc]/30 whitespace-nowrap">
                        AI首選
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">
                    {p.jockey} / {p.trainer}
                  </div>
                </td>

                {/* 評級 */}
                <td className="px-3 py-3">
                  <GradeBadge grade={p.grade} />
                </td>

                {/* 狀態 */}
                <td className="px-3 py-3 text-xs whitespace-nowrap">
                  <span className={`
                    ${p.conditionLabel === "上升中" ? "text-emerald-400" : ""}
                    ${p.conditionLabel === "狀態穩" ? "text-slate-300" : ""}
                    ${p.conditionLabel === "略降" ? "text-amber-400" : ""}
                    ${p.conditionLabel === "狀態差" ? "text-red-400" : ""}
                    ${!["上升中","狀態穩","略降","狀態差"].includes(p.conditionLabel) ? "text-slate-400" : ""}
                  `}>
                    {p.conditionLabel || "—"}
                  </span>
                </td>

                {/* 系統勝率 */}
                <td className="px-3 py-3 font-mono text-slate-300 whitespace-nowrap">
                  {p.winProbability}
                  <span className="text-slate-500 text-xs">%</span>
                </td>

                {/* 即時賠率 */}
                <td className="px-3 py-3 font-mono whitespace-nowrap">
                  <span className={p.winOdds === "—" ? "text-slate-600" : "text-amber-300 font-bold"}>
                    {p.winOdds}
                  </span>
                  {p.winOdds !== "—" && (
                    <span className="text-xs text-slate-500 ml-1">
                      → 夜{p.modelOdds}
                    </span>
                  )}
                </td>

                {/* 推算投注額 */}
                <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                  <span className={p.estWinInvestment ? (p.isTheoretical ? "text-slate-500" : "text-[#fff005]") : "text-slate-700"}>
                    {fmtMoney(p.estWinInvestment, p.isTheoretical)}
                  </span>
                </td>

                {/* QIN聚合 */}
                <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                  <span className={p.estQINInvestment ? (p.isTheoretical ? "text-slate-500" : "text-[#ff9205]") : "text-slate-700"}>
                    {fmtMoney(p.estQINInvestment, p.isTheoretical)}
                  </span>
                </td>

                {/* QPL聚合 */}
                <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                  <span className={p.estQPLInvestment ? (p.isTheoretical ? "text-slate-500" : "text-[#f953f7]") : "text-slate-700"}>
                    {fmtMoney(p.estQPLInvestment, p.isTheoretical)}
                  </span>
                </td>

                {/* EV */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <EVBadge ev={p.expectedValue} />
                </td>

                {/* 建議 */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <CombatBadge status={p.combatStatus} />
                </td>

                {/* Alert */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <AlertBadge alert={p.moneyAlert} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function AnalyticsDashboard({ raceDetail, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-xl bg-slate-800/60 animate-pulse" />
        <SkeletonTable />
      </div>
    )
  }

  if (!raceDetail) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-3">
        <span className="text-4xl">🏇</span>
        <p className="text-sm">選擇賽事以開始分析</p>
      </div>
    )
  }

  const { predictions, oddsStructure, isPreRace, pools } = raceDetail

  return (
    <div className="space-y-4">

      {/* 1. Pool Summary */}
      <PoolSummary pools={pools} isPreRace={isPreRace} />

      {/* AI Learning Feedback */}
      {!isPreRace && oddsStructure && (
        <AIFeedbackPanel predictions={predictions} oddsStructure={oddsStructure} />
      )}

      {/* 2. Odds Structure Banner */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          📊 賽局結構分析
        </h3>
        <OddsStructureBanner oddsStructure={oddsStructure} isPreRace={isPreRace} />
      </div>

      {/* 3. EV Matrix Table */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          📊 EV 分析矩陣
        </h3>
        <p className="text-xs text-slate-600 mb-3">
          {predictions?.filter(p => !String(p.runnerNumber).startsWith("R")).length ?? 0} 匹
          {isPreRace && (
            <span className="ml-2 text-slate-600">
              · 推算投注額為夜賠估算（~28M獨贏 / ~20M連贏基準）
            </span>
          )}
        </p>
        <EVMatrixTable predictions={predictions} isPreRace={isPreRace} oddsStructure={oddsStructure} />
      </div>

    </div>
  )
}
