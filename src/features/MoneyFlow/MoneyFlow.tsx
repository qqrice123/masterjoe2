// src/components/features/MoneyFlow/MoneyFlow.tsx
// 資金追蹤模組 — WinPoolChart + QIN熱力圖 + 大戶警報 + 彩池總覽

import { useMemo } from "react"
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
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
  estQPLInvestment?: number | null
  moneyAlert?:       "large_bet" | "steady" | "drifting"
  oddsHistory:       OddsHistory
  winProbModel:      number
  modelOdds:         number
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
  od1Number?: string | number
  od2Number?: string | number
  od3Number?: string | number
  od4Number?: string | number
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


// ─── Sub-component: InvestmentRankingChart ────────────────────────────────────
function InvestmentRankingChart({ predictions, oddsStructure }: { predictions: Prediction[], oddsStructure?: OddsStructure }) {
  // 1. Find the absolute #1 system pick based on modelOdds
  const systemTopPick = [...predictions]
    .filter(p => !String(p.runnerNumber).startsWith("R"))
    .sort((a, b) => a.modelOdds - b.modelOdds)[0]?.runnerNumber

  // 2. Find top 2 EV picks (excluding systemTopPick to avoid collision, or just let it override visually)
  const evPicks = [...predictions]
    .filter(p => p.combatStatus === "GO" && !String(p.runnerNumber).startsWith("R"))
    .sort((a, b) => b.expectedValue - a.expectedValue)
    .slice(0, 2)
    .map(p => p.runnerNumber)

  // Sort horses by WIN investment (descending) and take all valid horses
  const data = predictions
    .filter(p => p.estWinInvestment != null && !String(p.runnerNumber).startsWith("R"))
    .sort((a, b) => (b.estWinInvestment ?? 0) - (a.estWinInvestment ?? 0))
    .map(p => ({
      runnerNumber: p.runnerNumber,
      winOdds: p.winOdds,
      win: Math.round((p.estWinInvestment ?? 0) / 1000), // in K
      qin: Math.round((p.estQINInvestment ?? 0) / 1000), // in K
      qpl: Math.round((p.estQPLInvestment ?? 0) / 1000), // in K
      qinWinRatio: p.estWinInvestment && p.estWinInvestment > 0 ? (p.estQINInvestment ?? 0) / p.estWinInvestment : 0,
      isSystemTopPick: p.runnerNumber === systemTopPick,
      isEvPick: evPicks.includes(p.runnerNumber),
      moneyAlert: p.moneyAlert,
      isOd1: String(p.runnerNumber) === String(oddsStructure?.od1Number),
      isOd2: String(p.runnerNumber) === String(oddsStructure?.od2Number),
      isOd3: String(p.runnerNumber) === String(oddsStructure?.od3Number),
      isOd4: String(p.runnerNumber) === String(oddsStructure?.od4Number),
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

    // Determine markers
    let showMarker = false;
    let markerColor = "";
    let textColor = "#0f1117";

    if (item.moneyAlert === "large_bet") {
      showMarker = true;
      markerColor = "#ef4444";
      textColor = "#ffffff";
    } else if (item.isSystemTopPick) {
      showMarker = true;
      markerColor = "#7dd3fc"; // Light blue for System Top Pick
      textColor = "#0f1117";
    } else if (item.isEvPick) {
      showMarker = true;
      markerColor = "#f472b6"; // Pink for EV Pick
      textColor = "#0f1117";
    }
    
    // Determine hot label
    let hotLabel = "";
    if (item.isOd1) hotLabel = "大熱";
    else if (item.isOd2) hotLabel = "次熱";
    else if (item.isOd3) hotLabel = "三熱";
    else if (item.isOd4) hotLabel = "四熱";

    return (
      <g>
        {/* Hot labels above the bar */}
        {hotLabel && (
          <text x={x + width / 2} y={y - (showMarker ? 28 : 10)} textAnchor="middle" fill="#fff005" fontSize={10} fontWeight="bold">
            {hotLabel}
          </text>
        )}
        
        {/* Alerts / AI pick markers */}
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
          formatter={(value: any, name: string) => [
            `HK$${value}K`, 
            name === "win" ? "獨贏 (WIN)" : name === "qin" ? "連贏 (QIN)" : "位置Q (QPL)"
          ]}
          labelFormatter={(label) => `馬號: #${label}`}
        />
        
        {/* Stacked Bars */}
        <Bar 
          dataKey="win" 
          stackId="a" 
          fill="#fff005" /* WIN #fff005 */
          radius={[0, 0, 2, 2]} 
        >
          {data.map((entry, index) => (
            <Cell key={`cell-win-${index}`} fill={entry.moneyAlert === "large_bet" ? "#ccb800" : "#fff005"} />
          ))}
        </Bar>
        <Bar 
          dataKey="qin" 
          stackId="a" 
          fill="#ff9205" /* QIN #ff9205 */
        >
          {data.map((entry, index) => (
             <Cell key={`cell-qin-${index}`} fill={entry.moneyAlert === "large_bet" ? "#cc7000" : "#ff9205"} />
          ))}
        </Bar>
        <Bar 
          dataKey="qpl" 
          stackId="a" 
          fill="#f953f7" /* QPL #f953f7 */
          radius={[2, 2, 0, 0]} 
          label={renderCustomBarLabel}
        >
          {data.map((entry, index) => (
             <Cell key={`cell-qpl-${index}`} fill={entry.moneyAlert === "large_bet" ? "#cc36cc" : "#f953f7"} />
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
            <th className="text-right py-2 px-2 font-normal">QPL估算</th>
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
                <td className="text-right py-2 px-2 font-mono text-[#05b0ff]">
                  {p.placeOdds === "—" ? "—" : p.placeOdds}
                </td>
                <td className="text-right py-2 px-2 font-mono text-[#fff005]">
                  {p.estWinInvestment ? `$${fmt(p.estWinInvestment)}` : "—"}
                </td>
                <td className="text-right py-2 px-2 text-slate-400">
                  {p.estWinInvestment ? pct(p.estWinInvestment, totalWin * 0.825) : "—"}
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

  // Find Top 2 QIN/QPL Overflow (where QIN or QPL ratio to WIN is highest, and has minimum investment to filter noise)
  const qinOverflows = useMemo(() => {
    return predictions
      .filter(p => !String(p.runnerNumber).startsWith("R") && (p.estWinInvestment ?? 0) > 10000)
      .map(p => {
        const win = (p.estWinInvestment ?? 0) / 1000;
        const qin = (p.estQINInvestment ?? 0) / 1000;
        const qpl = (p.estQPLInvestment ?? 0) / 1000;
        const qinWinRatio = win > 0 ? qin / win : 0;
        const qplWinRatio = win > 0 ? qpl / win : 0;
        const maxRatio = Math.max(qinWinRatio, qplWinRatio);
        return { runnerNumber: p.runnerNumber, winOdds: p.winOdds, win, qin, qpl, qinWinRatio, qplWinRatio, maxRatio };
      })
      .filter(d => d.maxRatio > 1.2) // QIN or QPL > 1.2x WIN
      .sort((a, b) => b.maxRatio - a.maxRatio)
      .slice(0, 2);
  }, [predictions]);

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
          color={pools?.WIN ? "text-[#fff005]" : "text-slate-500"}
          note={isPreRace ? "預估 ~28M" : undefined}
        />
        <PoolBar
          label="位置 PLA" icon="🥈"
          amount={pools?.PLA ?? 0}
          color="text-[#05b0ff]"
          note={isPreRace ? "賽前" : undefined}
        />
        <PoolBar
          label="連贏 QIN" icon="🔗"
          amount={pools?.QIN ?? 0}
          color="text-[#ff9205]"
          note={isPreRace ? "預估 ~20M" : undefined}
        />
        <PoolBar
          label="位置Q QPL" icon="🎯"
          amount={pools?.QPL ?? 0}
          color="text-[#f953f7]"
        />
      </div>

      {/* ── Combined Chart: Odds Structure & Investment ── */}
      <div className="bg-[#0d1421] rounded-2xl p-4 border border-[#2a3352]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            💵 賽局結構與資金堆疊分析
          </h3>
          <span className="text-xs text-slate-500">
            {isPreRace ? "預估（賽前）" : "實時彩池"}
          </span>
        </div>

        {/* 1. Odds Structure Banner */}
        {oddsStruct && oddsStruct.raceTypeCode !== "UNKNOWN" && (
          <div className="mb-6">
            <OddsStructureBanner oddsStructure={oddsStruct} />
          </div>
        )}

        {/* 2. Investment Stacked Bar Chart */}
        <InvestmentRankingChart predictions={predictions} oddsStructure={oddsStruct} />
        
        <p className="text-xs text-slate-600 mt-4 flex gap-4 flex-wrap">
          <span className="flex items-center"><span className="inline-block w-3 h-3 bg-[#fff005] mr-1"></span>獨贏 WIN</span>
          <span className="flex items-center"><span className="inline-block w-3 h-3 bg-[#ff9205] mr-1"></span>連贏 QIN</span>
          <span className="flex items-center"><span className="inline-block w-3 h-3 bg-[#f953f7] mr-1"></span>位置Q QPL</span>
          <span className="flex items-center"><span className="inline-block w-3 h-3 bg-[#ef4444] rounded-full mr-1"></span>大戶落飛</span>
          <span className="flex items-center"><span className="inline-block w-3 h-3 bg-[#7dd3fc] rounded-full mr-1"></span>AI系統首選</span>
          <span className="flex items-center"><span className="inline-block w-3 h-3 bg-[#f472b6] rounded-full mr-1"></span>正EV馬</span>
          <span className="flex items-center"><span className="text-[#fff005] font-bold mr-1">大熱</span>賽局四大熱門</span>
        </p>

        {/* ── 黃金三步指南 (Golden Three Steps Guide) ── */}
        <div className="mt-6 border-t border-[#1e293b] pt-5">
          <h4 className="text-xs font-bold text-slate-300 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>💡</span> 實戰看盤「黃金三步」
            </div>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Step 1 */}
            <div className="bg-[#131b2b] rounded-lg p-3 border border-[#2a3352]">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-blue-900/50 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded">STEP 1</span>
                <span className="text-xs font-bold text-slate-200">先定調：看左上角賽局</span>
              </div>
              <ul className="text-[10px] text-slate-400 space-y-1.5 pl-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400 mt-0.5">●</span>
                  <span><span className="text-emerald-400 font-bold">馬膽局</span>：找一匹穩膽，尋找冷門配腳</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-blue-400 mt-0.5">●</span>
                  <span><span className="text-blue-400 font-bold">分立局</span>：提防大熱互殺，找半冷門粉藍/粉紅點</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-red-400 mt-0.5">●</span>
                  <span><span className="text-red-400 font-bold">混亂局</span>：放棄大熱，找AI粉藍/粉紅點或大戶紅點博大霧</span>
                </li>
              </ul>
            </div>

            {/* Step 2 */}
            <div className="bg-[#131b2b] rounded-lg p-3 border border-[#2a3352]">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-amber-900/50 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded">STEP 2</span>
                <span className="text-xs font-bold text-slate-200">找異常：看柱體比例</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mb-2">
                尋找<span className="text-orange-400 font-medium">「WIN黃柱短，但QIN橘柱或QPL紫柱特別長」</span>的馬。
              </p>
              <div className="flex items-end gap-2 mt-2 h-10 border-l border-b border-slate-700 pl-2 pb-1 relative">
                <div className="w-3 bg-[#fff005] h-2 absolute bottom-1 left-2"></div>
                <div className="w-3 bg-[#ff9205] h-4 absolute bottom-3 left-2"></div>
                <div className="w-3 bg-[#f953f7] h-4 absolute bottom-7 left-2 rounded-t-sm"></div>
                <span className="text-[9px] text-slate-500 absolute bottom-2 left-7">連贏/位置Q異常溢出，幕後搏殺位</span>
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-[#131b2b] rounded-lg p-3 border border-[#2a3352]">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-purple-900/50 text-purple-400 text-[10px] font-bold px-1.5 py-0.5 rounded">STEP 3</span>
                <span className="text-xs font-bold text-slate-200">鎖目標：看頂端標記</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                在右半部（10倍以上半冷門/冷門區）尋找標記：
              </p>
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#7dd3fc] border border-[#38bdf8] flex items-center justify-center text-[8px] font-bold text-[#0f1117]">1</span>
                  <span className="text-[10px] text-slate-300">AI 系統首選 (模型勝率最高)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#f472b6] border border-[#db2777] flex items-center justify-center text-[8px] font-bold text-[#0f1117]">8</span>
                  <span className="text-[10px] text-slate-300">正EV馬 (價值被低估)，必作配腳</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-red-500 border border-red-700 flex items-center justify-center text-[8px] font-bold text-white">3</span>
                  <span className="text-[10px] text-slate-300">大戶落飛 (急跌≥30%)，小注博冷</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* QIN/QPL 異常溢出 推薦區塊 (僅限混亂局顯示) */}
          {oddsStruct?.raceTypeCode === "CHAOTIC" && qinOverflows.length > 0 && (
            <div className="mt-4 p-3 bg-amber-950/20 border border-amber-700/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 text-xs font-bold flex items-center gap-1">
                  <span className="animate-pulse">🔥</span> 系統偵測：QIN/QPL 異常溢出 (混亂局幕後搏殺位)
                </span>
                <span className="text-[10px] text-slate-400">連贏/位置Q資金比例大幅高於獨贏，可能有內幕信心</span>
              </div>
              <div className="flex gap-3 flex-wrap">
                {qinOverflows.map((horse) => (
                  <div key={horse.runnerNumber} className="flex items-center gap-2 bg-[#0d1421] border border-amber-900/50 px-3 py-1.5 rounded-md">
                    <span className="w-5 h-5 rounded-full bg-slate-700 text-white flex items-center justify-center text-[10px] font-bold">
                      {horse.runnerNumber}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-200">賠率: {horse.winOdds}</span>
                      <span className="text-[10px] text-amber-400">
                        {horse.qinWinRatio >= horse.qplWinRatio 
                          ? `Q/W 比例: ${horse.qinWinRatio.toFixed(1)}x` 
                          : `QPL/W 比例: ${horse.qplWinRatio.toFixed(1)}x`
                        }
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
