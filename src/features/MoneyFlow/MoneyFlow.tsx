// src/components/features/MoneyFlow/MoneyFlow.tsx
// 資金追蹤模組 — WinPoolChart + QIN熱力圖 + 大戶警報 + 彩池總覽

import { useMemo } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, Legend
} from "recharts"
import { OddsStructureBanner } from "../AnalyticsDashboard/OddsStructureBanner"

// ─── Types ───────────────────────────────────────────────────────────────────
interface OddsHistory {
  overnight: number | null
  min30:     number | null
  min15:     number | null
  current:   string | number | "—"
}

interface Prediction {
  runnerNumber:      string | number
  runnerName:        string
  winOdds:           string | number | "—"
  placeOdds?:        string | number | "—"
  score:             number
  grade:             "A" | "B" | "C" | "D"
  estWinInvestment:  number | null
  estQINInvestment:  number | null
  moneyAlert?:       "large_bet" | "steady" | "drifting"
  oddsHistory:       OddsHistory
  winProbModel:      number
  expectedValue:     number
  combatStatus:      string
  investmentLabel:   string
}

interface PoolsData {
  WIN: number
  PLA: number
  QIN: number
  QPL: number
  DBL: number
}

interface OddsStructure {
  raceType:     "馬膽局" | "分立局" | "混亂局" | "未能判斷"
  raceTypeCode: "BANKER" | "SPLIT" | "CHAOTIC" | "UNKNOWN"
  od1:          number
  od2:          number
  od3:          number
  od4:          number
  od1Name?: string
  od2Name?: string
  od3Name?: string
  od4Name?: string
  od1Count?:    number
  od2Count?:    number
  od3Count?:    number
  hotCount:     number
  coldSignal:   boolean
  qinFocus:     "od1_group" | "od2_od3_group" | "spread" | "unknown"
  topBanker:    string | null
  coldCandidates: (string | number)[]
  description:  string
  tip:          string
  oddsPattern?: string
}

interface RaceDetail {
  predictions:    Prediction[]
  pools:          PoolsData | null
  isPreRace:      boolean
  oddsStructure:  OddsStructure
  raceName:       string
  distance:       number
  going:          string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(0)}K`
  : String(n)

const pct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—"

// ─── Sub-component: PoolBar ───────────────────────────────────────────────────
function PoolBar({
  label, amount, color, icon, note
}: { label: string; amount: number; color: string; icon: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 bg-[#1c2333] rounded-xl p-3 border border-[#2a3352]">
      <div className={`text-2xl w-10 text-center`}>{icon}</div>
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

// ─── Sub-component: OddsMovementChart ────────────────────────────────────────
function OddsMovementChart({ predictions }: { predictions: Prediction[] }) {
  // Only include horses with odds history data
  const horses = predictions
    .filter(p =>
      !String(p.runnerNumber).startsWith("R") &&
      p.winOdds !== "—" &&
      (p.oddsHistory.min15 || p.oddsHistory.min30 || p.oddsHistory.overnight)
    )

  if (horses.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        暫無歷史賠率數據（需賽前 30 分鐘開始收集）
      </div>
    )
  }

  // Build chart data: each horse is a series, timepoints are X-axis
  const timePoints = ["隔夜", "賽前30分", "賽前15分", "即時"]
  const chartData = timePoints.map((label, i) => {
    const entry: Record<string, any> = { time: label }
    horses.forEach(p => {
      const key = `#${p.runnerNumber}`
      const h = p.oddsHistory
      const vals = [h.overnight, h.min30, h.min15, parseFloat(String(p.winOdds))]
      const v = vals[i]
      entry[key] = v != null && !isNaN(Number(v)) ? Number(v) : null
    })
    return entry
  })

  const COLORS = [
    "#3b82f6","#10b981","#f59e0b","#ef4444",
    "#8b5cf6","#ec4899","#06b6d4","#84cc16",
    "#fb923c","#a855f7","#22c55e","#eab308",
    "#f43f5e","#38bdf8","#f87171","#4ade80"
  ]

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} reversed />
        <Tooltip
          contentStyle={{ background: "#0f1117", border: "1px solid #2a3352", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#cbd5e1" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {horses.map((p, i) => (
          <Line
            key={p.runnerNumber}
            type="monotone"
            dataKey={`#${p.runnerNumber}`}
            name={`#${p.runnerNumber} ${p.runnerName}`}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Sub-component: InvestmentRankingChart ────────────────────────────────────
function InvestmentRankingChart({ predictions }: { predictions: Prediction[] }) {
  // Find top 2 AI picks based on highest expectedValue (or score)
  const topAIPicks = [...predictions]
    .filter(p => p.combatStatus === "GO" && !String(p.runnerNumber).startsWith("R"))
    .sort((a, b) => b.expectedValue - a.expectedValue)
    .slice(0, 2)
    .map(p => p.runnerNumber)

  // Sort horses by WIN investment (descending) and take top 12
  const data = predictions
    .filter(p => p.estWinInvestment != null && !String(p.runnerNumber).startsWith("R"))
    .sort((a, b) => (b.estWinInvestment ?? 0) - (a.estWinInvestment ?? 0))
    .slice(0, 12)
    .map(p => ({
      runnerNumber: p.runnerNumber,
      winOdds: p.winOdds,
      win: Math.round((p.estWinInvestment ?? 0) / 1000), // in K
      qin: Math.round((p.estQINInvestment ?? 0) / 1000), // in K
      isTopPick: topAIPicks.includes(p.runnerNumber), // Limit AI markers to max 2
      moneyAlert: p.moneyAlert,
    }))

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        賠率開盤後顯示投注估算
      </div>
    )
  }

  // Custom X-Axis Tick to show Horse Number and Win Odds below it
  const CustomTick = (props: any) => {
    const { x, y, payload } = props;
    const item = data.find(d => String(d.runnerNumber) === String(payload.value));
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={10} dy={4} textAnchor="middle" fill="#cbd5e1" fontSize={12} fontWeight="bold">
          {payload.value}
        </text>
        <text x={0} y={26} dy={4} textAnchor="middle" fill="#94a3b8" fontSize={11}>
          {item?.winOdds}
        </text>
      </g>
    );
  };

  // Custom label for the top of the stacked bar to show total or markers
  const renderCustomBarLabel = (props: any) => {
    const { x, y, width, value, index } = props;
    const item = data[index];
    if (!item) return null;

    // We can render a circle marker for specific horses (e.g. money alert or top pick)
    const showMarker = item.moneyAlert === "large_bet" || item.isTopPick;
    const markerColor = item.moneyAlert === "large_bet" ? "#ef4444" : "#ffffff"; // Red for alert, white for top pick
    const textColor = item.moneyAlert === "large_bet" ? "#ffffff" : "#000000";

    return (
      <g>
        {showMarker && (
          <g transform={`translate(${x + width / 2}, ${y - 12})`}>
            <circle cx={0} cy={0} r={10} fill={markerColor} stroke="#1e293b" strokeWidth={1} />
            <text x={0} y={4} textAnchor="middle" fill={textColor} fontSize={10} fontWeight="bold">
              {item.runnerNumber}
            </text>
          </g>
        )}
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 25, right: 10, left: -20, bottom: 25 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis 
          dataKey="runnerNumber" 
          tick={<CustomTick />} 
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
          cursor={{ fill: '#1e293b', opacity: 0.4 }}
          contentStyle={{ background: "#0f1117", border: "1px solid #2a3352", borderRadius: 8, fontSize: 12 }}
          formatter={(value: any, name: string) => [`HK$${value}K`, name === "win" ? "獨贏 (WIN)" : "連贏 (QIN)"]}
          labelFormatter={(label) => `馬號: #${label}`}
        />
        
        {/* Stacked Bars */}
        <Bar 
          dataKey="win" 
          stackId="a" 
          fill="#fcd34d" /* Light orange/yellow for WIN */
          radius={[0, 0, 2, 2]} 
        >
          {data.map((entry, index) => (
            <Cell key={`cell-win-${index}`} fill={entry.moneyAlert === "large_bet" ? "#f59e0b" : "#fcd34d"} />
          ))}
        </Bar>
        <Bar 
          dataKey="qin" 
          stackId="a" 
          fill="#fed7aa" /* Lighter orange for QIN */
          radius={[2, 2, 0, 0]} 
          label={renderCustomBarLabel}
        >
          {data.map((entry, index) => (
             <Cell key={`cell-qin-${index}`} fill={entry.moneyAlert === "large_bet" ? "#fdba74" : "#fed7aa"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Sub-component: AlertFeed ─────────────────────────────────────────────────
function AlertFeed({ predictions }: { predictions: Prediction[] }) {
  const alerts = predictions
    .filter(p => p.moneyAlert === "large_bet" || p.moneyAlert === "drifting")
    .sort((a, b) => {
      // large_bet first, then by win investment desc
      if (a.moneyAlert !== b.moneyAlert)
        return a.moneyAlert === "large_bet" ? -1 : 1
      return (b.estWinInvestment ?? 0) - (a.estWinInvestment ?? 0)
    })

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <div className="text-2xl">🔍</div>
        <p className="text-slate-500 text-sm">暫無異常資金警報</p>
        <p className="text-slate-600 text-xs">賠率大幅下跌（≥30%）時觸發大戶警報</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {alerts.map(p => {
        const isLargeBet = p.moneyAlert === "large_bet"
        const cur  = parseFloat(String(p.oddsHistory.current))
        const prev = p.oddsHistory.min15 ?? p.oddsHistory.min30 ?? p.oddsHistory.overnight
        const drop = prev && !isNaN(cur) ? ((Number(prev) - cur) / Number(prev) * 100).toFixed(1) : null

        return (
          <div
            key={p.runnerNumber}
            className={`flex items-center gap-3 rounded-xl p-3 border ${
              isLargeBet
                ? "bg-emerald-950/40 border-emerald-700/50"
                : "bg-red-950/30 border-red-700/40"
            }`}
          >
            <div className="text-xl">{isLargeBet ? "🟢" : "🔴"}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-slate-100">#{p.runnerNumber}</span>
                <span className="text-sm text-slate-300 truncate">{p.runnerName}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                  isLargeBet ? "bg-emerald-800/60 text-emerald-300" : "bg-red-800/60 text-red-300"
                }`}>
                  {isLargeBet ? "大戶落飛" : "資金撤離"}
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5 flex gap-3 flex-wrap">
                {drop && (
                  <span className={isLargeBet ? "text-emerald-400" : "text-red-400"}>
                    賠率{isLargeBet ? "↓" : "↑"} {drop}%
                  </span>
                )}
                {prev && <span>之前: {prev}</span>}
                <span>即時: {p.winOdds}</span>
                {p.estWinInvestment && (
                  <span className="text-blue-400">
                    WIN估算: HK${fmt(p.estWinInvestment)}
                  </span>
                )}
              </div>
            </div>
            <div className={`text-right shrink-0 ${
              p.grade === "A" ? "text-emerald-400"
              : p.grade === "B" ? "text-blue-400"
              : "text-slate-500"
            }`}>
              <div className="text-lg font-bold">{p.grade}</div>
              <div className="text-xs text-slate-500">評級</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Sub-component: OddsTable ─────────────────────────────────────────────────
function OddsTable({ predictions, totalWin }: { predictions: Prediction[]; totalWin: number }) {
  const rows = predictions
    .filter(p => !String(p.runnerNumber).startsWith("R"))
    .slice(0, 14)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-[#2a3352]">
            <th className="text-left py-2 pr-2 font-normal">馬號</th>
            <th className="text-right py-2 px-2 font-normal">獨贏</th>
            <th className="text-right py-2 px-2 font-normal">位置</th>
            <th className="text-right py-2 px-2 font-normal">WIN估算</th>
            <th className="text-right py-2 px-2 font-normal">市佔%</th>
            <th className="text-right py-2 px-2 font-normal">QIN估算</th>
            <th className="text-right py-2 pl-2 font-normal">狀態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const alert = p.moneyAlert
            const isLarge = alert === "large_bet"
            const isDrift = alert === "drifting"
            const oddsNum = parseFloat(String(p.winOdds))
            const oddsChanged =
              p.oddsHistory.min15 &&
              !isNaN(oddsNum) &&
              Number(p.oddsHistory.min15) !== oddsNum

            return (
              <tr
                key={p.runnerNumber}
                className={`border-b border-[#1a2035] transition-colors ${
                  isLarge ? "bg-emerald-950/20" : isDrift ? "bg-red-950/10" : "hover:bg-[#1c2333]"
                }`}
              >
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      p.grade === "A" ? "bg-emerald-800 text-emerald-200"
                      : p.grade === "B" ? "bg-blue-800 text-blue-200"
                      : "bg-slate-700 text-slate-300"
                    }`}>
                      {p.runnerNumber}
                    </span>
                    <span className="text-slate-300 truncate max-w-[80px]">{p.runnerName}</span>
                  </div>
                </td>
                <td className={`text-right py-2 px-2 font-mono font-bold ${
                  isLarge ? "text-emerald-400" : isDrift ? "text-red-400" : "text-slate-100"
                }`}>
                  {p.winOdds}
                  {oddsChanged && (
                    <span className={`ml-1 text-[10px] ${
                      Number(p.oddsHistory.min15) > oddsNum ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {Number(p.oddsHistory.min15) > oddsNum ? "↓" : "↑"}
                    </span>
                  )}
                </td>
                <td className="text-right py-2 px-2 font-mono text-slate-400">
                  {p.placeOdds === "—" ? "—" : p.placeOdds}
                </td>
                <td className="text-right py-2 px-2 font-mono text-blue-300">
                  {p.estWinInvestment ? `$${fmt(p.estWinInvestment)}` : "—"}
                </td>
                <td className="text-right py-2 px-2 text-slate-400">
                  {p.estWinInvestment ? pct(p.estWinInvestment, totalWin * 0.825) : "—"}
                </td>
                <td className="text-right py-2 px-2 font-mono text-purple-300">
                  {p.estQINInvestment ? `$${fmt(p.estQINInvestment)}` : "—"}
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
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function MoneyFlow({ raceDetail }: { raceDetail: RaceDetail | null }) {
  const predictions = raceDetail?.predictions ?? []
  const pools       = raceDetail?.pools
  const oddsStruct  = raceDetail?.oddsStructure
  const isPreRace   = raceDetail?.isPreRace ?? true

  const totalInvestment = useMemo(
    () => predictions.reduce((s, p) => s + (p.estWinInvestment ?? 0), 0),
    [predictions]
  )

  const alertCount = predictions.filter(
    p => p.moneyAlert === "large_bet" || p.moneyAlert === "drifting"
  ).length

  if (!raceDetail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="text-4xl">💰</div>
        <p className="text-slate-400 text-sm">請先選擇場次載入資料</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── Header Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <PoolBar
          label="獨贏 WIN" icon="🏆"
          amount={pools?.WIN ?? 0}
          color={pools?.WIN ? "text-blue-300" : "text-slate-500"}
          note={isPreRace ? "預估 ~28M" : undefined}
        />
        <PoolBar
          label="位置 PLA" icon="🥈"
          amount={pools?.PLA ?? 0}
          color="text-slate-300"
          note={isPreRace ? "賽前" : undefined}
        />
        <PoolBar
          label="連贏 QIN" icon="🔗"
          amount={pools?.QIN ?? 0}
          color="text-purple-300"
          note={isPreRace ? "預估 ~20M" : undefined}
        />
        <PoolBar
          label="位置Q QPL" icon="🎯"
          amount={pools?.QPL ?? 0}
          color="text-amber-300"
        />
      </div>

      {/* ── Race Structure ── */}
      {oddsStruct && oddsStruct.raceTypeCode !== "UNKNOWN" && (
        <OddsStructureBanner oddsStructure={oddsStruct} />
      )}

      {/* ── Two-col grid: Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Odds Movement Chart */}
        <div className="bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              📈 賠率走勢（歷史快照）
            </h3>
            <span className="text-xs text-slate-500">隔夜 → 即時</span>
          </div>
          <OddsMovementChart predictions={predictions} />
          <p className="text-xs text-slate-600 mt-2">
            * 賠率向下 = 市場看好（資金湧入）
          </p>
        </div>

        {/* Investment Ranking */}
        <div className="bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              💵 獨贏 / 連贏 資金堆疊分析
            </h3>
            <span className="text-xs text-slate-500">
              {isPreRace ? "預估（賽前）" : "實時彩池"}
            </span>
          </div>
          <InvestmentRankingChart predictions={predictions} />
          <p className="text-xs text-slate-600 mt-2 flex gap-4">
            <span><span className="inline-block w-3 h-3 bg-[#fcd34d] mr-1"></span>獨贏 WIN</span>
            <span><span className="inline-block w-3 h-3 bg-[#fed7aa] mr-1"></span>連贏 QIN</span>
            <span><span className="inline-block w-3 h-3 bg-[#ef4444] rounded-full mr-1"></span>大戶落飛</span>
            <span><span className="inline-block w-3 h-3 bg-white rounded-full mr-1"></span>AI首選</span>
          </p>
        </div>
      </div>

      {/* ── Alert Feed ── */}
      <div className="bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            🚨 大戶資金警報
            {alertCount > 0 && (
              <span className="bg-red-700 text-red-100 text-xs px-2 py-0.5 rounded-full animate-pulse">
                {alertCount}
              </span>
            )}
          </h3>
          <span className="text-xs text-slate-500">賠率下跌 ≥ 30% 觸發</span>
        </div>
        <AlertFeed predictions={predictions} />
      </div>

      {/* ── Full Odds Table ── */}
      <div className="bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">
            📊 全場資金明細
          </h3>
          {totalInvestment > 0 && (
            <span className="text-xs text-slate-500">
              WIN估算總額: HK${fmt(totalInvestment)}
            </span>
          )}
        </div>
        <OddsTable predictions={predictions} totalWin={pools?.WIN ?? 28_000_000} />
      </div>

      {/* ── Pre-race disclaimer ── */}
      {isPreRace && (
        <div className="text-xs text-slate-600 text-center py-2">
          💡 賽前狀態：投注額為基於 82.5% 抽水率逆向推算的估算值，賽後彩池開啟後顯示實際數據
        </div>
      )}
    </div>
  )
}
