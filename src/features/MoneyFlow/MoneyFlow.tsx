// src/components/features/MoneyFlow/MoneyFlow.tsx
// 資金追蹤模組 — WinPoolChart + QIN熱力圖 + 大戶警報 + 彩池總覽
// FIX: removed all (p as any); WeightRD fields now typed via api.types.ts

import { memo, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BarChart, Bar, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import type { XAxisProps } from "recharts"
import { OddsStructureBanner } from "../AnalyticsDashboard/OddsStructureBanner"
import { aiEngine }             from "../../services/aiLearning"
import { api, OddsStructure, Prediction, RaceDetail } from "../../services/api"
import { AlertFeed }            from "./AlertFeed"
import { getWeightRDTooltip }   from "../../services/weightRD.utils"
import { SmartMoneyBoard }      from "./SmartMoneyBoard"
import { parsePastedLargeBets, mergeLargeBetsIntoPredictions } from "./utils/largeBets"
import { SmartMoneyHistory }    from "./SmartMoneyHistory"

// ─── Constants ────────────────────────────────────────────────────────────────
const CHART_COLORS = {
  WIN:   "#fff005",
  QIN:   "#ff9205",
  QPL:   "#f953f7",
  ALERT: "#ef4444",
  AI:    "#7dd3fc",
  EV:    "#f472b6",
} as const

const POOL_DEDUCTION         = 0.825   // HKJC WIN 彩池保留率 (82.5%)
const MIN_INVESTMENT_THRESHOLD = 10_000 // QIN 溢出最低投資門檻（港元）
// FIX: 1.0 is correct because both QIN & WIN already apply POOL_DEDUCTION.
// Old value 1.2 assumed QIN was gross; 1.0 maintains equivalent sensitivity.
const QIN_OVERFLOW_RATIO     = 1.0

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000  ? `${(n / 1_000).toFixed(0)}K`
  : String(n)

const pct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—"

// ─── WeightRD badge helpers ───────────────────────────────────────────────────
function WeightRDBadges({ p }: { p: Prediction }) {
  return (
    <>
      {p.isGoldenWeightRD && (
        <span
          className="ml-1 text-emerald-400 cursor-help"
          title={p.weightRD != null && p.weightRDBenchmark != null
            ? getWeightRDTooltip({
                weightRD:          p.weightRD,
                weightRDBenchmark: p.weightRDBenchmark,
                isGoldenWeightRD:  p.isGoldenWeightRD ?? false,
                goldenScore:       p.goldenScore ?? 0,
                isStrongStar:      p.isStrongStar ?? false,
                isBlueStar:        p.isBlueStar ?? false,
              })
            : `WeightRD 篩選命中 (${p.goldenScore?.toFixed(1)}% 低於基準)`}
        >
          ✨
        </span>
      )}
      {!p.isGoldenWeightRD && p.isStrongStar && (
        <span
          className="ml-1 text-yellow-400 cursor-help"
          title={`★ WeightRD 強信號 ≤10倍 (${p.goldenScore?.toFixed(1)}% 低於基準)`}
        >
          ★
        </span>
      )}
      {!p.isGoldenWeightRD && !p.isStrongStar && p.isBlueStar && (
        <span
          className="ml-1 text-blue-400 cursor-help"
          title="⚠ WeightRD 監察信號 (10–19.9倍，非主要篩選目標)"
        >
          ★
        </span>
      )}
    </>
  )
}

// ─── Sub-component: PoolBar ───────────────────────────────────────────────────
function PoolBar({
  label, amount, color, icon, note,
}: {
  label: string; amount: number; color: string; icon: string; note?: string
}) {
  return (
    <div className="flex items-center gap-3 bg-[#1c2333] rounded-xl p-3 border border-[#2a3352]">
      <div className="text-2xl w-10 text-center">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-slate-400">{label}</span>
          {note && <span className="text-xs text-slate-600">{note}</span>}
        </div>
        <div className={`text-lg font-bold font-mono ${color}`}>
          {amount > 0 ? `HK$${fmt(amount)}` : "—"}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-component: InvestmentRankingChart ────────────────────────────────────
const InvestmentRankingChart = memo(function InvestmentRankingChart({
  predictions,
  oddsStructure,
}: {
  predictions:   Prediction[]
  oddsStructure?: OddsStructure
}) {
  const aiTopPick = useMemo(
    () => aiEngine.getTopPick(predictions, oddsStructure),
    [predictions, oddsStructure]
  )

  const systemTopPick = useMemo(() => {
    let bestRunner: string | number | null = null
    let maxRatio = 0
    predictions.forEach(p => {
      if (String(p.runnerNumber).startsWith("R")) return
      const win = p.estWinInvestment ?? 0
      const qin = p.estQINInvestment ?? 0
      const qpl = p.estQPLInvestment ?? 0

      // 尋找「WIN黃柱短，QIN/QPL橘紫柱特別長」的馬，代表聰明錢繞過獨贏直接入連贏
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

  const data = predictions
    .filter(p => p.estWinInvestment != null && !String(p.runnerNumber).startsWith("R"))
    .sort((a, b) => (b.estWinInvestment ?? 0) - (a.estWinInvestment ?? 0))
    .map(p => ({
      runnerNumber: p.runnerNumber,
      winOdds:      p.winOdds,
      win:          Math.round((p.estWinInvestment ?? 0) / 1000),
      qin:          Math.round((p.estQINInvestment ?? 0) / 1000),
      qpl:          Math.round((p.estQPLInvestment ?? 0) / 1000),
      qinWinRatio:  p.estWinInvestment && p.estWinInvestment > 0
                      ? (p.estQINInvestment ?? 0) / p.estWinInvestment : 0,
      isSystemTopPick: String(p.runnerNumber) === String(systemTopPick),
      isAiTopPick:     String(p.runnerNumber) === String(aiTopPick),
      moneyAlert:      p.moneyAlert,
      isGoldenWeightRD: p.isGoldenWeightRD ?? false,
      isOd1: String(p.runnerNumber) === String(oddsStructure?.od1Number),
      isOd2: String(p.runnerNumber) === String(oddsStructure?.od2Number),
      isOd3: String(p.runnerNumber) === String(oddsStructure?.od3Number),
      isOd4: String(p.runnerNumber) === String(oddsStructure?.od4Number),
    }))

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        暫無投注數據
      </div>
    )
  }

  // Custom tick: horse number + odds
  const CustomTick = (props: XAxisProps & { payload?: { value: string } }) => {
    const { x, y, payload } = props as any
    const item = data.find(d => String(d.runnerNumber) === String(payload?.value))
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={10} dy={4} textAnchor="middle" fill="#cbd5e1" fontSize={12} fontWeight="bold">
          {payload?.value}
        </text>
        <text x={0} y={26} dy={4} textAnchor="middle" fill="#94a3b8" fontSize={11}>
          {item?.winOdds}
        </text>
      </g>
    )
  }

  const renderCustomBarLabel = (props: any) => {
      const { x, y, width, index } = props
      const item = data[index]
      if (!item) return null

      const markers = []
      if (item.moneyAlert === "large_bet") markers.push({ color: "#ef4444", text: "#ffffff" })
      if (item.isSystemTopPick) markers.push({ color: "#7dd3fc", text: "#0f1117" })
      if (item.isAiTopPick) markers.push({ color: "#22c55e", text: "#ffffff" })

      const hotLabel =
        item.isOd1 ? "①" : item.isOd2 ? "②" : item.isOd3 ? "③" : item.isOd4 ? "④" : ""

      let currentY = y - 6

      return (
        <g>
          {markers.map((m, i) => {
            const cy = currentY - 8
            currentY -= 18
            return (
              <g key={i} transform={`translate(${x + width / 2}, ${cy})`}>
                <circle cx={0} cy={0} r={8} fill={m.color} stroke="#1e293b" strokeWidth={1} />
                <text x={0} y={3} textAnchor="middle" fill={m.text} fontSize={9} fontWeight="bold">
                  {item.runnerNumber}
                </text>
              </g>
            )
          })}
          {item.isGoldenWeightRD && (
            <text
              x={x + width / 2} y={currentY - 2}
              textAnchor="middle" fill="#34d399" fontSize={11}
            >
              ✨
            </text>
          )}
          {item.isGoldenWeightRD && (currentY -= 14)}
          {hotLabel && (
            <text
              x={x + width / 2} y={currentY - 2}
              textAnchor="middle" fill="#fff005" fontSize={11} fontWeight="bold"
            >
              {hotLabel}
            </text>
          )}
        </g>
      )
    }

  return (
    <ResponsiveContainer width="100%" height={270}>
      <BarChart data={data} margin={{ top: 30, right: 10, left: -20, bottom: 25 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="runnerNumber"
          tick={CustomTick as any}
          axisLine={{ stroke: "#334155" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          unit="K"
        />
        <Tooltip
          cursor={{ fill: "#1e293b", opacity: 0.4 }}
          contentStyle={{
            background: "#0f1117",
            border: "1px solid #2a3352",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value: any, name: string) =>
            [`HK$${value}K`, name === "win" ? "WIN" : name === "qin" ? "QIN" : "QPL"]
          }
        />
        <Bar dataKey="win" stackId="a" fill={CHART_COLORS.WIN} radius={[0, 0, 2, 2]}>
          {data.map((entry, index) => (
            <Cell
              key={`cell-win-${index}`}
              fill={entry.moneyAlert === "large_bet" ? "#ccb800" : CHART_COLORS.WIN}
            />
          ))}
        </Bar>
        <Bar dataKey="qin" stackId="a" fill={CHART_COLORS.QIN}>
          {data.map((entry, index) => (
            <Cell
              key={`cell-qin-${index}`}
              fill={entry.moneyAlert === "large_bet" ? "#cc7000" : CHART_COLORS.QIN}
            />
          ))}
        </Bar>
        <Bar dataKey="qpl" stackId="a" fill={CHART_COLORS.QPL} radius={[2, 2, 0, 0]}
          label={renderCustomBarLabel}>
          {data.map((entry, index) => (
            <Cell
              key={`cell-qpl-${index}`}
              fill={entry.moneyAlert === "large_bet" ? "#cc36cc" : CHART_COLORS.QPL}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
})

// ─── Sub-component: OddsTable ─────────────────────────────────────────────────
const OddsTable = memo(function OddsTable({
  predictions,
  totalWin,
}: {
  predictions: Prediction[]
  totalWin:    number
}) {
  const rows = predictions
    .filter(p => !String(p.runnerNumber).startsWith("R"))

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-[#2a3352]">
            <th className="text-left py-2 pr-2 font-normal">馬號</th>
            <th className="text-right py-2 px-2 font-normal">獨贏</th>
            <th className="text-right py-2 px-2 font-normal">位置</th>
            <th className="text-right py-2 px-2 font-normal">EV</th>
            <th className="text-right py-2 px-2 font-normal">WIN估算</th>
            <th className="text-right py-2 px-2 font-normal">市佔%</th>
            <th className="text-right py-2 px-2 font-normal">QIN估算</th>
            <th className="text-right py-2 px-2 font-normal">QPL估算</th>
            <th className="text-right py-2 pl-2 font-normal">狀態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const alert     = p.moneyAlert
            const isLarge   = alert === "large_bet"
            const isDrift   = alert === "drifting"
            const oddsNum   = parseFloat(String(p.winOdds))
            // FIX: use prev3min first (3-min granularity), fall back to min15
            const refOdds   = p.oddsHistory?.prev3min ?? p.oddsHistory?.min15
            const oddsChanged =
              refOdds != null && !isNaN(oddsNum) && Number(refOdds) !== oddsNum

            return (
              <tr
                key={p.runnerNumber}
                className={`border-b border-[#1a2035] transition-colors
                  ${isLarge ? "bg-emerald-950/20" : isDrift ? "bg-red-950/10" : ""}
                  hover:bg-[#1c2333]`}
              >
                {/* Horse name + WeightRD badges */}
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center
                      text-xs font-bold
                      ${p.grade === "A" ? "bg-emerald-800 text-emerald-200"
                      : p.grade === "B" ? "bg-blue-800 text-blue-200"
                      : "bg-slate-700 text-slate-300"}`}>
                      {p.runnerNumber}
                    </span>
                    <span className="text-slate-300 truncate max-w-[80px]">
                      {p.runnerName}
                    </span>
                    {/* FIX: typed WeightRD badges — no (p as any) */}
                    <WeightRDBadges p={p} />
                  </div>
                </td>

                {/* Odds with movement indicator */}
                <td className={`text-right py-2 px-2 font-mono font-bold
                  ${isLarge ? "text-emerald-400" : isDrift ? "text-red-400" : "text-slate-100"}`}>
                  {p.winOdds}
                  {oddsChanged && (
                    <span className={`ml-1 text-[10px]
                      ${Number(refOdds) > oddsNum ? "text-emerald-400" : "text-red-400"}`}>
                      {Number(refOdds) > oddsNum ? "↓" : "↑"}
                    </span>
                  )}
                </td>

                <td className="text-right py-2 px-2 font-mono text-[#05b0ff]">
                  {p.placeOdds === "—" ? "—" : p.placeOdds}
                </td>

                <td className={`text-right py-2 px-2 font-mono font-bold
                  ${p.expectedValue > 0.1 ? "text-emerald-400"
                  : p.expectedValue > 0   ? "text-amber-400"
                  : "text-red-400"}`}>
                  {p.expectedValue > 0 ? "+" : ""}
                  {(p.expectedValue * 100).toFixed(0)}%
                </td>

                <td className="text-right py-2 px-2 font-mono text-[#fff005]">
                  {p.estWinInvestment ? `$${fmt(p.estWinInvestment)}` : "—"}
                </td>

                {/* FIX: pool share divides by gross pool (before deduction) */}
                <td className="text-right py-2 px-2 text-slate-400">
                  {p.estWinInvestment
                    ? pct(p.estWinInvestment, totalWin * POOL_DEDUCTION)
                    : "—"}
                </td>

                <td className="text-right py-2 px-2 font-mono text-[#ff9205]">
                  {p.estQINInvestment ? `$${fmt(p.estQINInvestment)}` : "—"}
                </td>
                <td className="text-right py-2 px-2 font-mono text-[#f953f7]">
                  {p.estQPLInvestment ? `$${fmt(p.estQPLInvestment)}` : "—"}
                </td>

                <td className="text-right py-2 pl-2">
                  {isLarge ? (
                    <span className="text-[10px] bg-emerald-800/60 text-emerald-300 px-1.5 py-0.5 rounded">
                      大戶 🟢
                    </span>
                  ) : isDrift ? (
                    <span className="text-[10px] bg-red-800/50 text-red-300 px-1.5 py-0.5 rounded">
                      撤資 🔴
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-600">穩定</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})

// ─── Main Component ───────────────────────────────────────────────────────────
export function MoneyFlow({ raceDetail, maxRaces }: { raceDetail: RaceDetail | null, maxRaces?: number }) {
  const [pastedText, setPastedText] = useState("")

  // Plan A: REST 輪詢 (每 15 秒)
  const { data: polledTxns } = useQuery({
    queryKey: ['large-bets', raceDetail?.venueCode, raceDetail?.raceNumber],
    queryFn: () => api.getLargeBets(raceDetail!.venueCode, raceDetail!.raceNumber),
    enabled: !!raceDetail?.venueCode && !!raceDetail?.raceNumber,
    refetchInterval: 15_000,
  })

  const predictions = useMemo(() => {
    const preds = raceDetail?.predictions ?? []
    
    // 合併 Plan A (Polled) 與 Plan C (Pasted) 資料
    let combinedTxns = polledTxns ?? []
    if (pastedText) {
      combinedTxns = [...combinedTxns, ...parsePastedLargeBets(pastedText)]
    }
    
    if (combinedTxns.length === 0) return preds
    
    return mergeLargeBetsIntoPredictions(preds, combinedTxns)
  }, [raceDetail, pastedText, polledTxns])

  const pools = raceDetail?.pools
  const oddsStruct   = raceDetail?.oddsStructure
  const isPreRace    = raceDetail?.isPreRace ?? true

  const totalInvestment = useMemo(
    () => predictions.reduce((s, p) => s + (p.estWinInvestment ?? 0), 0),
    [predictions],
  )

  const alertCount = predictions.filter(
    p => p.moneyAlert === "large_bet" || p.moneyAlert === "drifting",
  ).length

  // FIX: QIN_OVERFLOW_RATIO is 1.0 (both sides already deducted by 0.825)
  const qinOverflows = useMemo(() => {
    return predictions
      .filter(p =>
        !String(p.runnerNumber).startsWith("R") &&
        (p.estWinInvestment ?? 0) > MIN_INVESTMENT_THRESHOLD,
      )
      .map(p => {
        const win        = (p.estWinInvestment ?? 0) / 1000
        const qin        = (p.estQINInvestment ?? 0) / 1000
        const qpl        = (p.estQPLInvestment ?? 0) / 1000
        const qinWinRatio = win > 0 ? qin / win : 0
        const qplWinRatio = win > 0 ? qpl / win : 0
        const maxRatio    = Math.max(qinWinRatio, qplWinRatio)
        return { runnerNumber: p.runnerNumber, winOdds: p.winOdds, win, qin, qpl,
                 qinWinRatio, qplWinRatio, maxRatio }
      })
      .filter(d => d.maxRatio > QIN_OVERFLOW_RATIO)
      .sort((a, b) => b.maxRatio - a.maxRatio)
      .slice(0, 2)
  }, [predictions])

  if (!raceDetail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="text-4xl">🏇</div>
        <p className="text-slate-400 text-sm">請先選擇場次載入資料</p>
      </div>
    )
  }

  return (
      <div className="space-y-4">
        {/* Daily Smart Money Board */}
        {raceDetail?.venueCode && maxRaces && maxRaces > 0 && (
          <SmartMoneyBoard venueCode={raceDetail.venueCode} totalRaces={maxRaces} />
        )}

        {/* Pool totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <PoolBar label="WIN" icon="🏆" amount={pools?.WIN ?? 0}
          color={pools?.WIN ? "text-[#fff005]" : "text-slate-500"}
          note={isPreRace ? "~28M" : undefined} />
        <PoolBar label="PLA" icon="🥈" amount={pools?.PLA ?? 0}
          color="text-[#05b0ff]"
          note={isPreRace ? "~估算" : undefined} />
        <PoolBar label="QIN" icon="🔗" amount={pools?.QIN ?? 0}
          color="text-[#ff9205]"
          note={isPreRace ? "~20M" : undefined} />
        <PoolBar label="Q/QPL" icon="💜" amount={pools?.QPL ?? 0}
          color="text-[#f953f7]" />
        <PoolBar label="DBL" icon="🔁" amount={pools?.DBL ?? 0}
          color="text-cyan-400" />
      </div>

      {/* Chart + structure */}
      <div className="bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            💰 資金分佈
          </h3>
          <span className="text-xs text-slate-500">
            {isPreRace ? "夜賠估算" : "實時彩池"}
          </span>
        </div>

        {oddsStruct && oddsStruct.raceTypeCode !== "UNKNOWN" && (
          <div className="mb-6">
            <OddsStructureBanner oddsStructure={oddsStruct} />
          </div>
        )}

        <InvestmentRankingChart predictions={predictions} oddsStructure={oddsStruct} />

        <p className="text-xs text-slate-600 mt-4 flex gap-4 flex-wrap">
          <span className="flex items-center">
            <span className="inline-block w-3 h-3 bg-[#fff005] mr-1" />WIN
          </span>
          <span className="flex items-center">
            <span className="inline-block w-3 h-3 bg-[#ff9205] mr-1" />QIN
          </span>
          <span className="flex items-center">
            <span className="inline-block w-3 h-3 bg-[#f953f7] mr-1" />Q/QPL
          </span>
          <span className="flex items-center">
            <span className="inline-block w-3 h-3 bg-[#ef4444] rounded-full mr-1" />大戶
          </span>
          <span className="flex items-center">
            <span className="inline-block w-3 h-3 bg-[#7dd3fc] rounded-full mr-1" />聰明錢(QIN/QPL異常)
          </span>
          <span className="flex items-center">
            <span className="inline-block w-3 h-3 bg-[#22c55e] rounded-full mr-1" />AI綜合首選
          </span>
          <span className="flex items-center">
            <span className="text-emerald-400 font-bold mr-1">✨</span>WeightRD命中(3–9x)
          </span>
        </p>

        {/* Smart Money Historical Dwell Time */}
        {raceDetail && <SmartMoneyHistory raceDetail={raceDetail} />}

        {/* Golden Three Steps Guide */}
        <div className="mt-6 border-t border-[#1e293b] pt-5">
          <h4 className="text-xs font-bold text-slate-300 mb-3">🏆 黃金三步法</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-[#131b2b] rounded-lg p-3 border border-[#2a3352]">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-blue-900/50 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded">
                  STEP 1
                </span>
                <span className="text-xs font-bold text-slate-200">賠率篩選 3–9x</span>
              </div>
              <ul className="text-[10px] text-slate-400 space-y-1.5 pl-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span><span className="text-emerald-400 font-bold">3–9倍</span> = 市場最準確定價帶</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-blue-400 mt-0.5">✓</span>
                  <span><span className="text-blue-400 font-bold">✨ 標記</span> = WeightRD 命中此區間</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-red-400 mt-0.5">✗</span>
                  <span><span className="text-red-400 font-bold">★ 藍色</span> 為監察僅，非主要目標</span>
                </li>
              </ul>
            </div>
            <div className="bg-[#131b2b] rounded-lg p-3 border border-[#2a3352]">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-amber-900/50 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded">
                  STEP 2
                </span>
                <span className="text-xs font-bold text-slate-200">資金確認</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                尋找「<span className="text-orange-400 font-medium">WIN黃柱短，QIN/QPL橘紫柱特別長</span>」的馬，代表聰明錢繞過獨贏直接入連贏。
              </p>
            </div>
            <div className="bg-[#131b2b] rounded-lg p-3 border border-[#2a3352]">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-purple-900/50 text-purple-400 text-[10px] font-bold px-1.5 py-0.5 rounded">
                  STEP 3
                </span>
                <span className="text-xs font-bold text-slate-200">交叉驗證</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                同時具備 ✨ + AI標記 或 ✨ + 大戶 的馬，訊號重疊，優先選擇。
              </p>
            </div>
          </div>
        </div>

        {/* QIN overflow alert */}
        {oddsStruct?.raceTypeCode === "CHAOTIC" && qinOverflows.length > 0 && (
          <div className="mt-4 p-3 bg-amber-950/20 border border-amber-700/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-400 text-xs font-bold flex items-center gap-1">
                <span className="animate-pulse">⚡</span> QIN/QPL溢出警報
              </span>
            </div>
            <div className="flex gap-3 flex-wrap">
              {qinOverflows.map(horse => (
                <div key={horse.runnerNumber}
                  className="flex items-center gap-2 bg-[#0d1421] border border-amber-900/50 px-3 py-1.5 rounded-md">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-white flex items-center justify-center text-[10px] font-bold">
                    {horse.runnerNumber}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-200">{horse.winOdds}</span>
                    <span className="text-[10px] text-amber-400">
                      {horse.qinWinRatio >= horse.qplWinRatio
                        ? `Q/W ${horse.qinWinRatio.toFixed(1)}x`
                        : `QPL/W ${horse.qplWinRatio.toFixed(1)}x`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Alert Feed */}
      <div className="bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            🚨 大戶警報
            {alertCount > 0 && (
              <span className="bg-red-700 text-red-100 text-xs px-2 py-0.5 rounded-full animate-pulse">
                {alertCount}
              </span>
            )}
          </h3>
          <span className="text-xs text-slate-500">過去 20 分鐘</span>
        </div>
        <AlertFeed predictions={predictions} isLoading={!raceDetail} />
      </div>

      {/* Manual Paste Section (Plan C) - Hidden per user request */}
      <div className="hidden bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
        <h3 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
          <span>📋 手動匯入大戶資料 (方案 C)</span>
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          直接貼上包含 4 組平行欄位的資料 (WIN交易 / WIN交易 / QIN交易 / QPL交易)，將即時更新上方圖表。
        </p>
        <textarea
          className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
          placeholder="[WIN交易] [WIN交易] [QIN交易] [QPL交易]&#10;時間 馬號 賠率 金額 Y 時間 馬號 賠率 金額 Y 時間 組合 賠率 金額 Y 時間 組合 賠率 金額 Y"
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
        />
        {pastedText && (
          <div className="mt-2 flex justify-end">
            <button 
              onClick={() => setPastedText("")}
              className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
            >
              清除資料
            </button>
          </div>
        )}
      </div>

      {/* Full odds table */}
      <div className="bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">📊 全場賠率一覽</h3>
          {totalInvestment > 0 && (
            <span className="text-xs text-slate-500">
              WIN估算總額 HK${fmt(totalInvestment)}
            </span>
          )}
        </div>
        <OddsTable
          predictions={predictions}
          totalWin={pools?.WIN ?? 28_000_000}
        />
      </div>

      {isPreRace && (
        <div className="text-xs text-slate-600 text-center py-2">
          ※ 投注額為夜賠推算，實際彩池開賽後以馬會實時數據為準（保留率 82.5%）
        </div>
      )}
    </div>
  )
}
