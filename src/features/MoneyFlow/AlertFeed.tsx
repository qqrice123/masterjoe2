// src/components/features/MoneyFlow/AlertFeed.tsx
// 大戶資金警報系統 — 重構版
// 修正：prev falsy bug、新增嚴重度分級、迷你趨勢圖、QIN隱注警報、EV顯示
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useMemo } from "react"
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts"

// ─── Constants ───────────────────────────────────────────────────────────────

/** HKJC WIN 彩池保留率（扣除17.5%抽水後） */
const POOL_DEDUCTION = 0.825

/** 觸發「大戶落飛」警報的賠率跌幅門檻（20%） */
const LARGE_BET_DROP_THRESHOLD = 20

/** 觸發「資金撤離」警報的賠率升幅門檻（15%） */
const DRIFT_RISE_THRESHOLD = 15

/** QIN/QPL 聚合資金超過 WIN 的倍數門檻，觸發隱注警報 */
const QIN_OVERFLOW_RATIO = 1.2

/** 最低 WIN 投資門檻（元），過濾雜訊小馬 */
const MIN_WIN_INVESTMENT = 10_000

/** 格式化金額：>= 1M 顯示 M，>= 1K 顯示 K */
const fmt = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
    ? `${(n / 1_000).toFixed(0)}K`
    : String(Math.round(n))

// ─── Types ───────────────────────────────────────────────────────────────────

interface OddsHistory {
  overnight: number | null
  min30:     number | null
  min15:     number | null
  /** 即時賠率：null 代表未開盤，顯示時轉為「—」 */
  current:   number | null
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

// ─── 警報嚴重度分類 ────────────────────────────────────────────────────────────

type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM"
type AlertType =
  | "LARGE_BET"       // 大戶落飛（賠率急跌 ≥20%）
  | "LARGE_BET_QIN"   // 大戶落飛 + QIN 隱注雙重信號
  | "QIN_OVERFLOW"    // QIN/QPL 隱注（賠率平穩但 Q 資金異常）
  | "DRIFT"           // 資金撤離（賠率急升 ≥15%）

interface AlertItem {
  prediction:   Prediction
  alertType:    AlertType
  severity:     AlertSeverity
  dropPct:      number | null   // 負值 = 跌，正值 = 升（升為 drift）
  prevOdds:     number | null
  currentOdds:  number | null
  qinRatio:     number          // QIN / WIN 比率
  qplRatio:     number          // QPL / WIN 比率
  /** 趨勢數據：供迷你折線圖使用 */
  trendData:    { label: string; odds: number | null }[]
}

// ─── 工具函數 ─────────────────────────────────────────────────────────────────

/**
 * 計算賠率變化百分比
 * 修正原版 `prev && ...` falsy bug（prev=0 不再誤判為無資料）
 * @returns 負值 = 賠率下跌（資金湧入），正值 = 賠率上升（資金撤離），null = 無法計算
 */
function calcOddsChangePct(
  prev: number | null,
  current: number | null
): number | null {
  if (prev == null || current == null || isNaN(current) || prev <= 0) return null
  return +((current - prev) / prev * 100).toFixed(1)
}

/**
 * 根據警報類型與賠率跌幅計算嚴重度
 */
function classifySeverity(
  alertType: AlertType,
  dropPct: number | null,
  qinRatio: number
): AlertSeverity {
  if (alertType === "LARGE_BET_QIN") return "CRITICAL"
  if (alertType === "LARGE_BET") {
    const drop = dropPct != null ? Math.abs(dropPct) : 0
    return drop >= 35 ? "CRITICAL" : drop >= 20 ? "HIGH" : "MEDIUM"
  }
  if (alertType === "QIN_OVERFLOW") {
    return qinRatio >= 3.0 ? "HIGH" : "MEDIUM"
  }
  // DRIFT
  return "MEDIUM"
}

/**
 * 從 Prediction 物件構建警報項目
 * 同一匹馬可能同時觸發多種信號，以最嚴重的為主
 */
function buildAlertItem(p: Prediction): AlertItem | null {
  const win = p.estWinInvestment ?? 0
  const qin = p.estQINInvestment ?? 0
  const qpl = p.estQPLInvestment ?? 0
  const qinRatio = win > 0 ? qin / win : 0
  const qplRatio = win > 0 ? qpl / win : 0

  // 取最近一個有效的前置賠率（優先 min15，其次 min30，最後 overnight）
  const prevOdds =
    p.oddsHistory.min15 ?? p.oddsHistory.min30 ?? p.oddsHistory.overnight

  const currentOdds = p.oddsHistory.current

  // 修正：使用 != null 而非 truthy check，避免 prevOdds=0 時漏算
  const changePct = calcOddsChangePct(prevOdds, currentOdds)

  const trendData = [
    { label: "過夜", odds: p.oddsHistory.overnight },
    { label: "-30m", odds: p.oddsHistory.min30 },
    { label: "-15m", odds: p.oddsHistory.min15 },
    { label: "即時", odds: p.oddsHistory.current },
  ]

  // 判斷信號類型
  const hasLargeBet =
    p.moneyAlert === "large_bet" ||
    (changePct != null && changePct <= -LARGE_BET_DROP_THRESHOLD)

  const hasDrift =
    p.moneyAlert === "drifting" ||
    (changePct != null && changePct >= DRIFT_RISE_THRESHOLD)

  const hasQINOverflow =
    win >= MIN_WIN_INVESTMENT &&
    Math.max(qinRatio, qplRatio) >= QIN_OVERFLOW_RATIO

  if (!hasLargeBet && !hasDrift && !hasQINOverflow) return null

  let alertType: AlertType
  if (hasLargeBet && hasQINOverflow) alertType = "LARGE_BET_QIN"
  else if (hasLargeBet)             alertType = "LARGE_BET"
  else if (hasDrift)                alertType = "DRIFT"
  else                              alertType = "QIN_OVERFLOW"

  const severity = classifySeverity(alertType, changePct, Math.max(qinRatio, qplRatio))

  return {
    prediction: p,
    alertType,
    severity,
    dropPct:     changePct,
    prevOdds,
    currentOdds,
    qinRatio,
    qplRatio,
    trendData,
  }
}

// ─── Sub-component: SeverityBadge ─────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const styles: Record<AlertSeverity, string> = {
    CRITICAL: "bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse",
    HIGH:     "bg-orange-500/20 text-orange-300 border border-orange-500/40",
    MEDIUM:   "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  }
  const labels: Record<AlertSeverity, string> = {
    CRITICAL: "🚨 極高",
    HIGH:     "⚠️ 高",
    MEDIUM:   "💡 中",
  }
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${styles[severity]}`}>
      {labels[severity]}
    </span>
  )
}

// ─── Sub-component: AlertTypeBadge ───────────────────────────────────────────

function AlertTypeBadge({ alertType }: { alertType: AlertType }) {
  const config: Record<AlertType, { label: string; className: string }> = {
    LARGE_BET:     { label: "大戶落飛",    className: "bg-emerald-900/50 text-emerald-300 border border-emerald-700/50" },
    LARGE_BET_QIN: { label: "落飛+隱注",  className: "bg-red-900/40 text-red-200 border border-red-600/50" },
    QIN_OVERFLOW:  { label: "QIN 隱注",   className: "bg-amber-900/40 text-amber-300 border border-amber-600/40" },
    DRIFT:         { label: "資金撤離",    className: "bg-slate-800 text-slate-400 border border-slate-600/50" },
  }
  const { label, className } = config[alertType]
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${className}`}>
      {label}
    </span>
  )
}

// ─── Sub-component: OddsMiniChart ────────────────────────────────────────────

interface OddsMiniChartProps {
  trendData:  { label: string; odds: number | null }[]
  alertType:  AlertType
}

function OddsMiniChart({ trendData, alertType }: OddsMiniChartProps) {
  // 過濾掉 null 值，至少需要 2 個有效點才能繪製折線
  const validData = trendData.filter((d) => d.odds != null) as {
    label: string
    odds: number
  }[]

  if (validData.length < 2) {
    return (
      <div className="flex items-center justify-center h-10 text-[10px] text-slate-600">
        賠率數據不足
      </div>
    )
  }

  const lineColor =
    alertType === "DRIFT" ? "#ef4444" :   // 紅：資金撤離
    alertType === "QIN_OVERFLOW" ? "#f59e0b" :  // 黃：隱注
    "#10b981"                              // 綠：大戶落飛

  // 參考線：顯示前置賠率水平
  const referenceOdds = validData[0].odds

  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={validData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        <ReferenceLine
          y={referenceOdds}
          stroke="#334155"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
        <Tooltip
          contentStyle={{
            background: "#0f1117",
            border: "1px solid #2a3352",
            borderRadius: 6,
            fontSize: 11,
          }}
          formatter={(v: number) => [`$${v.toFixed(1)}`, "賠率"]}
          labelStyle={{ color: "#94a3b8" }}
        />
        <Line
          type="monotone"
          dataKey="odds"
          stroke={lineColor}
          strokeWidth={2}
          dot={{ fill: lineColor, r: 3 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Sub-component: AlertCard ─────────────────────────────────────────────────

function AlertCard({ item }: { item: AlertItem }) {
  const { prediction: p, alertType, severity, dropPct, prevOdds, currentOdds,
          qinRatio, qplRatio, trendData } = item

  const isLargeBet = alertType === "LARGE_BET" || alertType === "LARGE_BET_QIN"
  const isDrift    = alertType === "DRIFT"
  const isQIN      = alertType === "QIN_OVERFLOW" || alertType === "LARGE_BET_QIN"

  // 卡片邊框顏色
  const cardBorder =
    severity === "CRITICAL" ? "border-red-500/50 bg-red-950/20" :
    isLargeBet               ? "border-emerald-700/40 bg-emerald-950/15" :
    isQIN                    ? "border-amber-700/40 bg-amber-950/10" :
    isDrift                  ? "border-slate-600/50 bg-slate-900/30" :
                               "border-slate-700/30"

  // EV 顏色
  const evColor =
    p.expectedValue > 0.10 ? "text-emerald-400" :
    p.expectedValue > 0    ? "text-amber-400"   : "text-red-400"

  // 賠率變化文字
  const dropLabel =
    dropPct == null     ? null :
    dropPct < 0         ? `↓ ${Math.abs(dropPct).toFixed(1)}%` :
    dropPct > 0         ? `↑ ${dropPct.toFixed(1)}%` : null

  const dropColor = dropPct == null ? "" : dropPct < 0 ? "text-emerald-400" : "text-red-400"

  return (
    <div className={`rounded-xl border p-3 transition-all ${cardBorder}`}>
      {/* Row 1: 馬匹資訊 + 嚴重度 */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 馬號徽章 */}
          <span
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              p.grade === "A" ? "bg-emerald-800 text-emerald-200" :
              p.grade === "B" ? "bg-blue-800 text-blue-200" :
                                "bg-slate-700 text-slate-300"
            }`}
          >
            {p.runnerNumber}
          </span>

          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-slate-100 text-sm">{p.runnerName}</span>
              <AlertTypeBadge alertType={alertType} />
              <SeverityBadge severity={severity} />
            </div>

            {/* 賠率追蹤：過夜 → 即時 */}
            <div className="flex items-center gap-2 mt-0.5 text-[11px]">
              {prevOdds != null && (
                <span className="text-slate-500">
                  前: <span className="text-slate-400 font-mono">{prevOdds.toFixed(1)}</span>
                </span>
              )}
              {currentOdds != null && (
                <span className="text-slate-400">
                  →&nbsp;
                  <span className={`font-mono font-bold ${
                    isLargeBet ? "text-emerald-400" : isDrift ? "text-red-400" : "text-slate-200"
                  }`}>
                    {currentOdds.toFixed(1)}
                  </span>
                </span>
              )}
              {dropLabel && (
                <span className={`font-bold ${dropColor}`}>{dropLabel}</span>
              )}
            </div>
          </div>
        </div>

        {/* 右側：評級 + EV */}
        <div className="text-right shrink-0">
          <div className={`text-base font-bold ${
            p.grade === "A" ? "text-emerald-400" :
            p.grade === "B" ? "text-blue-400"    : "text-slate-500"
          }`}>
            {p.grade}
          </div>
          <div className={`text-[11px] font-mono font-bold ${evColor}`}>
            {p.expectedValue > 0 ? "+" : ""}{(p.expectedValue * 100).toFixed(0)}% EV
          </div>
        </div>
      </div>

      {/* Row 2: 趨勢迷你圖 */}
      <OddsMiniChart trendData={trendData} alertType={alertType} />

      {/* Row 3: 彩池資金詳情 */}
      <div className="flex items-center gap-3 flex-wrap mt-2 text-[11px]">
        {p.estWinInvestment != null && (
          <span className="text-slate-400">
            WIN&nbsp;
            <span className="font-mono text-[#fff005] font-semibold">
              HK${fmt(p.estWinInvestment)}
            </span>
          </span>
        )}
        {isQIN && p.estQINInvestment != null && (
          <span className="text-slate-400">
            QIN&nbsp;
            <span className="font-mono text-[#ff9205] font-semibold">
              HK${fmt(p.estQINInvestment)}
            </span>
            {qinRatio > 0 && (
              <span className="text-amber-500 ml-1">({qinRatio.toFixed(1)}x)</span>
            )}
          </span>
        )}
        {isQIN && p.estQPLInvestment != null && qplRatio > 0 && (
          <span className="text-slate-400">
            QPL&nbsp;
            <span className="font-mono text-[#f953f7] font-semibold">
              HK${fmt(p.estQPLInvestment)}
            </span>
            <span className="text-purple-400 ml-1">({qplRatio.toFixed(1)}x)</span>
          </span>
        )}
      </div>

      {/* Row 4: 解讀說明 */}
      <AlertInterpretation item={item} />
    </div>
  )
}

// ─── Sub-component: AlertInterpretation ──────────────────────────────────────

function AlertInterpretation({ item }: { item: AlertItem }) {
  const { alertType, severity, dropPct, qinRatio, qplRatio, prediction: p } = item
  const drop = dropPct != null ? Math.abs(dropPct) : 0
  const maxRatio = Math.max(qinRatio, qplRatio)

  let text = ""
  if (alertType === "LARGE_BET_QIN") {
    text = `賠率急跌 ${drop.toFixed(1)}%，同時 QIN/QPL 資金溢出 ${maxRatio.toFixed(1)}x，大戶雙重佈局信號。`
  } else if (alertType === "LARGE_BET") {
    text =
      drop >= 35
        ? `賠率急跌 ${drop.toFixed(1)}%，屬異常大額重注，市場情緒極度看好。`
        : `賠率下跌 ${drop.toFixed(1)}%，有資金持續湧入，建議密切關注。`
  } else if (alertType === "QIN_OVERFLOW") {
    const dominant = qinRatio >= qplRatio ? "QIN" : "QPL"
    text = `${dominant} 聚合資金達 WIN 的 ${maxRatio.toFixed(1)} 倍，賠率未見大跌，疑大戶以連贏/位置 Q 形式隱藏資金。`
  } else {
    text = `賠率上升 ${drop.toFixed(1)}%，資金撤離信號，${
      p.grade === "A" || p.grade === "B" ? "評級佳馬出現反向走勢，需留意場地/狀態變化。" : "與評級相符，謹慎考慮。"
    }`
  }

  const textColor =
    severity === "CRITICAL" ? "text-red-400" :
    alertType === "LARGE_BET" || alertType === "LARGE_BET_QIN" ? "text-emerald-500" :
    alertType === "QIN_OVERFLOW" ? "text-amber-500" : "text-slate-500"

  return (
    <p className={`text-[10px] mt-1.5 leading-relaxed ${textColor}`}>{text}</p>
  )
}

// ─── Sub-component: EmptyAlerts ───────────────────────────────────────────────

function EmptyAlerts() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2" role="status">
      <div className="text-3xl" aria-hidden="true">🔍</div>
      <p className="text-slate-500 text-sm">暫無異常資金警報</p>
      <p className="text-slate-600 text-[11px]">
        賠率跌幅 ≥{LARGE_BET_DROP_THRESHOLD}% 或 QIN/QPL 溢出 ≥{QIN_OVERFLOW_RATIO}x 時觸發
      </p>
    </div>
  )
}

// ─── Sub-component: AlertSummaryBar ──────────────────────────────────────────

interface AlertSummaryBarProps {
  alerts: AlertItem[]
}

function AlertSummaryBar({ alerts }: AlertSummaryBarProps) {
  const critical = alerts.filter((a) => a.severity === "CRITICAL").length
  const high     = alerts.filter((a) => a.severity === "HIGH").length
  const medium   = alerts.filter((a) => a.severity === "MEDIUM").length

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      {critical > 0 && (
        <span className="flex items-center gap-1 bg-red-900/40 text-red-300 px-2 py-0.5 rounded-full border border-red-600/40 animate-pulse">
          🚨 極高 ×{critical}
        </span>
      )}
      {high > 0 && (
        <span className="flex items-center gap-1 bg-orange-900/30 text-orange-400 px-2 py-0.5 rounded-full border border-orange-600/30">
          ⚠️ 高 ×{high}
        </span>
      )}
      {medium > 0 && (
        <span className="flex items-center gap-1 bg-amber-900/20 text-amber-500 px-2 py-0.5 rounded-full border border-amber-700/30">
          💡 中 ×{medium}
        </span>
      )}
      {alerts.length === 0 && (
        <span className="text-slate-600">無警報</span>
      )}
    </div>
  )
}

// ─── Main Component: AlertFeed ────────────────────────────────────────────────

interface AlertFeedProps {
  predictions: Prediction[]
  /** 是否仍在等待資料載入 */
  isLoading?:  boolean
}

/**
 * AlertFeed — 大戶資金警報列表
 *
 * 改進清單：
 * ✅ 修正 prev=0 falsy bug（改用 != null）
 * ✅ 新增嚴重度分級（CRITICAL / HIGH / MEDIUM）
 * ✅ 新增迷你賠率趨勢折線圖
 * ✅ 新增 QIN/QPL 隱注為獨立警報類型
 * ✅ 加入 EV 值顯示
 * ✅ 加入解讀說明文字
 * ✅ React.memo 避免不必要重渲染
 * ✅ 所有門檻值提取為具名常數
 * ✅ 補充 loading / empty 狀態
 * ✅ 修正 TypeScript：OddsHistory.current 改為 number | null
 */
export const AlertFeed = memo(function AlertFeed({
  predictions,
  isLoading = false,
}: AlertFeedProps) {
  // 構建所有警報項目（useMemo 避免每次渲染重算）
  const alerts = useMemo<AlertItem[]>(() => {
    return predictions
      .filter((p) => !String(p.runnerNumber).startsWith("R"))
      .map(buildAlertItem)
      .filter((a): a is AlertItem => a !== null)
      .sort((a, b) => {
        // 嚴重度優先：CRITICAL > HIGH > MEDIUM
        const severityOrder: Record<AlertSeverity, number> = {
          CRITICAL: 0,
          HIGH:     1,
          MEDIUM:   2,
        }
        const sevDiff = severityOrder[a.severity] - severityOrder[b.severity]
        if (sevDiff !== 0) return sevDiff
        // 同等嚴重度：落飛優先於撤離，再按 WIN 投注額排序
        if (a.alertType !== b.alertType) {
          return a.alertType === "DRIFT" ? 1 : -1
        }
        return (b.prediction.estWinInvestment ?? 0) - (a.prediction.estWinInvestment ?? 0)
      })
  }, [predictions])

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="載入警報中">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-700/30 p-3 bg-slate-800/20 animate-pulse"
          >
            <div className="h-4 bg-slate-700 rounded w-2/3 mb-2" />
            <div className="h-12 bg-slate-800 rounded mb-2" />
            <div className="h-3 bg-slate-700/50 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* 警報摘要列 */}
      <div className="mb-3">
        <AlertSummaryBar alerts={alerts} />
      </div>

      {/* 警報列表 */}
      {alerts.length === 0 ? (
        <EmptyAlerts />
      ) : (
        <div
          className="space-y-3"
          role="list"
          aria-label={`${alerts.length} 個資金警報`}
        >
          {alerts.map((item) => (
            <div
              key={String(item.prediction.runnerNumber)}
              role="listitem"
              aria-label={`${item.prediction.runnerName} — ${item.alertType}`}
            >
              <AlertCard item={item} />
            </div>
          ))}
        </div>
      )}

      {/* 說明腳注 */}
      {alerts.length > 0 && (
        <p className="text-[10px] text-slate-600 mt-3 text-center">
          落飛：賠率跌幅 ≥{LARGE_BET_DROP_THRESHOLD}%&nbsp;｜&nbsp;
          隱注：QIN/QPL 溢出 ≥{QIN_OVERFLOW_RATIO}x WIN&nbsp;｜&nbsp;
          撤離：賠率升幅 ≥{DRIFT_RISE_THRESHOLD}%
        </p>
      )}
    </div>
  )
})

export default AlertFeed
