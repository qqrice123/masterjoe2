// src/features/AnalyticsDashboard/index.tsx
// FIX: (p as any) removed; WeightRD fields typed; timeAdvantage typed; prev3min used

import { memo, useMemo, useState } from "react"
import { OddsStructureBanner }    from "./OddsStructureBanner"
import { Prediction, RaceDetail, OddsStructure } from "../../services/api"
import { aiEngine }               from "../../services/aiLearning"
import { getWeightRDTooltip }     from "../../services/weightRD.utils"

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtMoney(n: number | null | undefined, isTheoretical?: boolean): string {
  if (n == null) return "—"
  const prefix = isTheoretical ? "~" : ""
  const m = n / 1_000_000
  if (m >= 1) return `${prefix}${m.toFixed(2)}M`
  const k = n / 1_000
  return `${prefix}${k.toFixed(0)}K`
}

function EVBadge({ ev }: { ev: number | undefined | null }) {
  if (ev == null || isNaN(ev))
    return <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-slate-700 text-slate-400">—</span>
  if (ev > 0.1)
    return <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-emerald-600 text-white">{ev.toFixed(2)}</span>
  if (ev > 0)
    return <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-amber-600 text-white">{ev.toFixed(2)}</span>
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
    GO:      { label: "🟢", cls: "bg-emerald-700 text-emerald-100" },
    CAUTION: { label: "⚠️",  cls: "bg-amber-800 text-amber-200"   },
    SHADOW:  { label: "Q",   cls: "bg-blue-800 text-blue-200"     },
    AVOID:   { label: "🚫",  cls: "bg-slate-800 text-slate-500"   },
  }
  const { label, cls } = map[status] ?? map.AVOID
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>
}

function AlertBadge({ alert }: { alert?: string }) {
  if (!alert || alert === "steady") return null
  if (alert === "large_bet")
    return <span className="text-xs text-emerald-400 font-bold animate-pulse">🟢 大戶</span>
  return <span className="text-xs text-red-400">🔴 撤資</span>
}

// FIX: typed WeightRD badges — no (p as any)
function WeightRDBadges({ p }: { p: Prediction }) {
  const tooltip =
    p.weightRD != null && p.weightRDBenchmark != null
      ? getWeightRDTooltip({
          weightRD:          p.weightRD,
          weightRDBenchmark: p.weightRDBenchmark,
          isGoldenWeightRD:  p.isGoldenWeightRD ?? false,
          goldenScore:       p.goldenScore       ?? 0,
          isStrongStar:      p.isStrongStar      ?? false,
          isBlueStar:        p.isBlueStar        ?? false,
        })
      : ""

  if (p.isGoldenWeightRD)
    return <span className="text-emerald-400 text-xs cursor-help" title={tooltip}>✨</span>
  if (p.isStrongStar)
    return <span className="text-yellow-400 text-xs cursor-help" title={`★ WeightRD ≤10倍 ${tooltip}`}>★</span>
  if (p.isBlueStar)
    return (
      <span className="text-blue-400 text-xs cursor-help"
        title="⚠ WeightRD 監察信號 (10–19.9倍)">
        ★
      </span>
    )
  return null
}

function SkeletonTable() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}
          className="h-10 rounded bg-slate-800/60 animate-pulse"
          style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  )
}

// ─── Pool Summary ─────────────────────────────────────────────────────────────
function PoolSummary({ pools, isPreRace }: { pools: RaceDetail["pools"]; isPreRace: boolean }) {
  const items = [
    { label: "WIN",   val: pools?.WIN,  color: pools?.WIN ? "text-[#fff005]" : "text-slate-500", icon: "🏆", note: isPreRace ? "~28M" : undefined },
    { label: "PLA",   val: pools?.PLA,  color: "text-[#05b0ff]",  icon: "🥈", note: undefined },
    { label: "QIN",   val: pools?.QIN,  color: "text-[#ff9205]",  icon: "🔗", note: isPreRace ? "~20M" : undefined },
    { label: "Q/QPL", val: pools?.QPL,  color: "text-[#f953f7]",  icon: "💜", note: undefined },
    { label: "DBL",   val: pools?.DBL,  color: "text-cyan-400",   icon: "🔁", note: undefined },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {items.map(({ label, val, color, icon, note }) => (
        <div key={label}
          className="flex items-center gap-3 bg-[#1c2333] rounded-xl p-3 border border-[#2a3352]">
          <div className="text-2xl w-10 text-center">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">{label}</span>
              {note && <span className="text-xs text-slate-600">{note}</span>}
            </div>
            <div className={`text-lg font-bold font-mono ${color}`}>
              {val && val > 0
                ? val >= 1_000_000 ? `HK$${(val / 1_000_000).toFixed(2)}M`
                  : val >= 1_000   ? `HK$${(val / 1_000).toFixed(0)}K`
                  : `HK$${val}`
                : "—"}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── AI Feedback Panel ────────────────────────────────────────────────────────
function AIFeedbackPanel({
  predictions,
  oddsStructure,
}: {
  predictions:    Prediction[]
  oddsStructure?: OddsStructure
}) {
  const [winner, setWinner]         = useState<string>("")
  const [hasTrained, setHasTrained] = useState(false)

  const handleTrain = () => {
    if (!winner) return
    aiEngine.feedbackResult(predictions, oddsStructure, winner)
    setHasTrained(true)
    setTimeout(() => setHasTrained(false), 3000)
  }

  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="text-xl hidden sm:block">🤖</div>
        <div>
          <h4 className="text-sm font-bold text-slate-200">AI 學習回饋</h4>
          <p className="text-xs text-slate-400">輸入賽果，讓系統自動修正特徵權重</p>
        </div>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <select
          className="bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-lg pl-3 pr-10 py-1.5 outline-none cursor-pointer flex-1 sm:flex-none"
          value={winner}
          onChange={e => setWinner(e.target.value)}
        >
          <option value="">選擇勝出馬…</option>
          {predictions
            .filter(p => !String(p.runnerNumber).startsWith("R"))
            .map(p => (
              <option key={p.runnerNumber} value={String(p.runnerNumber)}>
                {p.runnerNumber} - {p.runnerName}
              </option>
            ))}
        </select>
        <button
          onClick={handleTrain}
          disabled={!winner || hasTrained}
          className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors whitespace-nowrap
            ${hasTrained ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"}
            disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {hasTrained ? "✓ 已更新" : "訓練"}
        </button>
      </div>
    </div>
  )
}

// ─── EV Matrix Table ──────────────────────────────────────────────────────────
function EVMatrixTable({
  predictions,
  isPreRace,
  oddsStructure,
  aiTopPick,
}: {
  predictions:    Prediction[]
  isPreRace:      boolean
  oddsStructure?: OddsStructure
  aiTopPick?:     string | number
}) {
  const systemTopPick = useMemo(() => {
    let bestRunner: string | number | null = null
    let maxRatio = 0
    predictions.forEach(p => {
      if (String(p.runnerNumber).startsWith("R")) return
      const win = p.estWinInvestment ?? 0
      const qin = p.estQINInvestment ?? 0
      const qpl = p.estQPLInvestment ?? 0

      if (win > 0 && (win + qin + qpl) > 5000) {
        const ratio = (qin + qpl) / win
        if (ratio > maxRatio) {
          maxRatio = ratio
          bestRunner = p.runnerNumber
        }
      }
    })
    return bestRunner
  }, [predictions])

  if (!predictions?.length) return null

  const headers = ["#", "馬匹", "級", "狀態", "勝率", "賠率", "WIN", "QIN", "QPL", "EV", "作戰", "警報"]

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/50">
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="bg-slate-900/80 border-b border-slate-700/50">
            {headers.map(h => (
              <th key={h}
                className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {predictions.map((p, i) => {
            const isReserve       = String(p.runnerNumber).startsWith("R")
            const isSystemTopPick = String(p.runnerNumber) === String(systemTopPick)
            const isAiTopPick     = String(p.runnerNumber) === String(aiTopPick)
            // FIX: use prev3min for fast drift detection
            const refOdds         = p.oddsHistory?.prev3min ?? p.oddsHistory?.min15
            const hasNoOdds       = p.winOdds === "—" || p.winOdds == null

            return (
              <tr key={p.runnerNumber}
                className={`border-b border-slate-800/50 transition-colors hover:bg-slate-800/30
                  ${i === 0 ? "bg-slate-800/20" : ""}
                  ${(isReserve || hasNoOdds) ? "opacity-40" : ""}
                  ${p.combatStatus === "GO"      ? "border-l-2 border-l-emerald-500" : ""}
                  ${p.combatStatus === "CAUTION" ? "border-l-2 border-l-amber-500"   : ""}`}
              >
                {/* Runner number + dots */}
                <td className="px-3 py-3 font-mono font-bold text-slate-300 whitespace-nowrap relative">
                  <div className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                    {isSystemTopPick && <span className="w-1.5 h-1.5 rounded-full bg-[#7dd3fc]" title="聰明錢(QIN/QPL異常)" />}
                    {isAiTopPick && <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" title="AI 系統建議" />}
                  </div>
                  <span className={(isSystemTopPick || isAiTopPick) ? "ml-3" : ""}>{p.runnerNumber}</span>
                  {p.draw > 0 && (
                    <span className="ml-1 text-xs text-slate-500">({p.draw})</span>
                  )}
                </td>

                {/* Horse name + badges */}
                <td className="px-3 py-3">
                  <div className="font-medium text-slate-200 flex flex-wrap items-center gap-1.5">
                    {p.runnerName}
                    <WeightRDBadges p={p} />
                    {isSystemTopPick && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#7dd3fc]/20 text-[#7dd3fc] border border-[#7dd3fc]/30 whitespace-nowrap" title="聰明錢繞過獨贏直接入連贏">
                        聰明錢
                      </span>
                    )}
                    {isAiTopPick && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30 whitespace-nowrap" title="AI綜合評估首選">
                        AI首選
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 whitespace-nowrap">
                    {p.jockey} / {p.trainer}
                  </div>
                </td>

                <td className="px-3 py-3"><GradeBadge grade={p.grade} /></td>

                {/* Condition label */}
                <td className="px-3 py-3 text-xs whitespace-nowrap">
                  <span className={
                    p.conditionLabel === "🔥" ? "text-emerald-400"
                    : p.conditionLabel === "✅" ? "text-slate-300"
                    : p.conditionLabel === "⚠️" ? "text-amber-400"
                    : p.conditionLabel === "❌" ? "text-red-400"
                    : "text-slate-400"
                  }>
                    {p.conditionLabel}
                  </span>
                </td>

                {/* Win probability */}
                <td className="px-3 py-3 font-mono text-slate-300 whitespace-nowrap">
                  {p.winProbability}
                </td>

                {/* Odds + 3-min history */}
                <td className="px-3 py-3 font-mono whitespace-nowrap">
                  <span className={p.winOdds ? "text-amber-300 font-bold" : "text-slate-600"}>
                    {p.winOdds}
                  </span>
                  {p.winOdds != null && refOdds != null && (
                    <span className="text-xs text-slate-500 ml-1">
                      3′{refOdds}
                    </span>
                  )}
                </td>

                {/* Pool estimates */}
                <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                  <span className={p.estWinInvestment
                    ? p.isTheoretical ? "text-slate-500" : "text-[#fff005]"
                    : "text-slate-700"}>
                    {fmtMoney(p.estWinInvestment, p.isTheoretical)}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                  <span className={p.estQINInvestment
                    ? p.isTheoretical ? "text-slate-500" : "text-[#ff9205]"
                    : "text-slate-700"}>
                    {fmtMoney(p.estQINInvestment, p.isTheoretical)}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                  <span className={p.estQPLInvestment
                    ? p.isTheoretical ? "text-slate-500" : "text-[#f953f7]"
                    : "text-slate-700"}>
                    {fmtMoney(p.estQPLInvestment, p.isTheoretical)}
                  </span>
                </td>

                <td className="px-3 py-3 whitespace-nowrap">
                  <EVBadge ev={p.expectedValue} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <CombatBadge status={p.combatStatus} />
                </td>

                {/* Alert + timeAdvantage */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <AlertBadge alert={p.moneyAlert} />
                  {/* FIX: timeAdvantage now typed, no (p as any) */}
                  {p.timeAdvantage != null && (
                    <span className={`ml-1 font-mono text-xs
                      ${p.timeAdvantage > 0    ? "text-emerald-400"
                      : p.timeAdvantage < -0.3 ? "text-red-400"
                      : "text-slate-300"}`}>
                      {p.timeAdvantage > 0 ? "+" : ""}{p.timeAdvantage.toFixed(2)}s
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  raceDetail: RaceDetail | null | undefined
  isLoading?: boolean
}

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
      {/* 1. Pool totals */}
      <PoolSummary pools={pools} isPreRace={isPreRace} />

      {/* 2. AI learning feedback (post-race only) */}
      {!isPreRace && oddsStructure && (
        <AIFeedbackPanel predictions={predictions} oddsStructure={oddsStructure} />
      )}

      {/* 3. Odds structure banner */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          賠率結構
        </h3>
        <OddsStructureBanner oddsStructure={oddsStructure} isPreRace={isPreRace} />
      </div>

      {/* 4. EV matrix */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          EV 矩陣
        </h3>
        <p className="text-xs text-slate-600 mb-3">
          {predictions?.filter(p => !String(p.runnerNumber).startsWith("R")).length ?? 0} 匹
          {isPreRace && (
            <span className="ml-2 text-slate-600">
              · 推算投注額為夜賠估算（~28M獨贏 / ~20M連贏基準）
            </span>
          )}
        </p>
        <EVMatrixTable
          predictions={predictions}
          isPreRace={isPreRace}
          oddsStructure={oddsStructure}
          aiTopPick={raceDetail?.topPick?.runnerNumber}
        />
      </div>
    </div>
  )
}
