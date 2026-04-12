// components/notifications/NotificationBell.tsx
// 通知鈴鐺組件 — 訂閱管理 + 即時警報面板
// ─────────────────────────────────────────────────────────────

"use client"

import React, {
  useState, useEffect, useRef, useCallback, memo
} from "react"
import { usePushNotifications } from "@/hooks/usePushNotifications"

// ─── Types ───────────────────────────────────────────────────
interface AlertRecord {
  id:            number
  alert_id:      string
  venue:         string
  race_no:       number
  race_name:     string
  runner_number: string
  runner_name:   string
  alert_type:    "LARGE_BET" | "LARGE_BET_QIN" | "QIN_OVERFLOW" | "DRIFT"
  severity:      "CRITICAL" | "HIGH" | "MEDIUM"
  prev_odds:     number | null
  current_odds:  number | null
  drop_pct:      number | null
  qin_ratio:     number | null
  detected_at:   string
}

// ─── Constants ───────────────────────────────────────────────
const SEVERITY_CONFIG = {
  CRITICAL: { label: "🚨 極高", dot: "bg-red-500 animate-ping",  ring: "border-red-500/40",  text: "text-red-400"    },
  HIGH:     { label: "⚠️ 高",   dot: "bg-orange-400",            ring: "border-orange-500/40", text: "text-orange-400" },
  MEDIUM:   { label: "💡 中",   dot: "bg-amber-400",             ring: "border-amber-500/30",  text: "text-amber-400"  },
} as const

const ALERT_TYPE_LABEL = {
  LARGE_BET:     "大戶落飛",
  LARGE_BET_QIN: "落飛+隱注",
  QIN_OVERFLOW:  "QIN 隱注",
  DRIFT:         "資金撤離",
} as const

// ─── Sub: PermissionPrompt ───────────────────────────────────
function PermissionPrompt({
  permission, isLoading, error, isSupported, onSubscribe
}: {
  permission:  string
  isLoading:   boolean
  error:       string | null
  isSupported: boolean
  onSubscribe: () => void
}) {
  if (!isSupported) {
    return (
      <div className="px-4 py-6 text-center">
        <div className="text-3xl mb-2">😔</div>
        <p className="text-slate-400 text-sm">此瀏覽器不支援推送通知</p>
        <p className="text-slate-600 text-xs mt-1">請使用 Chrome / Edge / Firefox（桌面版）</p>
      </div>
    )
  }

  if (permission === "denied") {
    return (
      <div className="px-4 py-6 text-center">
        <div className="text-3xl mb-2">🔕</div>
        <p className="text-slate-400 text-sm font-medium">通知已被封鎖</p>
        <p className="text-slate-600 text-xs mt-1 leading-relaxed">
          請在瀏覽器網址列按鎖頭圖示<br />→「通知」→「允許」
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 text-center border-b border-slate-800">
      <div className="text-2xl mb-2">🔔</div>
      <p className="text-slate-300 text-sm font-medium mb-1">開啟即時警報通知</p>
      <p className="text-slate-500 text-xs mb-4 leading-relaxed">
        關閉頁面後仍可收到大戶落飛、<br />QIN 隱注等警報
      </p>
      {error && (
        <p className="text-red-400 text-xs mb-3 bg-red-900/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <button
        onClick={onSubscribe}
        disabled={isLoading}
        className={`
          w-full py-2.5 rounded-xl text-sm font-bold transition-all
          ${isLoading
            ? "bg-slate-700 text-slate-400 cursor-not-allowed"
            : "bg-emerald-700 hover:bg-emerald-600 text-white active:scale-95"
          }
        `}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            處理中…
          </span>
        ) : "允許通知"}
      </button>
    </div>
  )
}

// ─── Sub: AlertItem ──────────────────────────────────────────
function AlertItem({ alert, onNavigate }: {
  alert:      AlertRecord
  onNavigate: (raceNo: number) => void
  key?: React.Key
}) {
  const sev     = SEVERITY_CONFIG[alert.severity]
  const typeLabel = ALERT_TYPE_LABEL[alert.alert_type]
  const time    = new Date(alert.detected_at).toLocaleTimeString("zh-HK", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong"
  })
  const venueLabel = alert.venue === "ST" ? "沙田" : "跑馬地"
  const drop    = alert.drop_pct != null ? Math.abs(alert.drop_pct) : null
  const isGain  = (alert.drop_pct ?? 0) > 0  // drift

  return (
    <button
      onClick={() => onNavigate(alert.race_no)}
      className={`
        w-full text-left rounded-xl border p-3 transition-all
        hover:bg-slate-800/60 active:scale-[0.98]
        ${alert.severity === "CRITICAL"
          ? "border-red-500/30 bg-red-950/10"
          : "border-slate-700/40 bg-slate-900/30"
        }
      `}
    >
      {/* Row 1: 場次 + 時間 */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500">
          {venueLabel} R{alert.race_no} · {alert.race_name}
        </span>
        <span className="text-[10px] text-slate-600">{time}</span>
      </div>

      {/* Row 2: 馬匹 + 信號 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-slate-100">
          {alert.runner_number}. {alert.runner_name}
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sev.ring} border ${sev.text}`}>
          {typeLabel}
        </span>
        <span className={`text-[10px] ${sev.text}`}>{sev.label}</span>
      </div>

      {/* Row 3: 賠率變化 */}
      {alert.prev_odds != null && alert.current_odds != null && (
        <div className="flex items-center gap-2 mt-1 text-[11px]">
          <span className="text-slate-500 font-mono">{alert.prev_odds.toFixed(1)}</span>
          <span className="text-slate-600">→</span>
          <span className={`font-mono font-bold ${isGain ? "text-red-400" : "text-emerald-400"}`}>
            {alert.current_odds.toFixed(1)}
          </span>
          {drop != null && (
            <span className={`font-bold ${isGain ? "text-red-400" : "text-emerald-400"}`}>
              {isGain ? `↑${drop.toFixed(1)}%` : `↓${drop.toFixed(1)}%`}
            </span>
          )}
          {alert.qin_ratio != null && alert.qin_ratio > 0 && (
            <span className="text-amber-500 ml-1">QIN {alert.qin_ratio.toFixed(1)}x</span>
          )}
        </div>
      )}
    </button>
  )
}

// ─── Sub: EmptyAlertList ─────────────────────────────────────
function EmptyAlertList() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2">
      <div className="text-3xl">🔍</div>
      <p className="text-slate-500 text-sm">今日暫無警報</p>
      <p className="text-slate-600 text-[11px]">賠率急跌或 QIN 異動時將自動通知</p>
    </div>
  )
}

// ─── Main: NotificationBell ──────────────────────────────────
interface NotificationBellProps {
  /** 點擊警報後跳轉到哪個場次（由父組件處理） */
  onNavigateToRace?: (raceNo: number) => void
}

export const NotificationBell = memo(function NotificationBell({
  onNavigateToRace,
}: NotificationBellProps) {
  const push         = usePushNotifications()
  const [open,       setOpen]       = useState(false)
  const [alerts,     setAlerts]     = useState<AlertRecord[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [lastReadAt, setLastReadAt] = useState<number>(() => Date.now())
  const [loadingList, setLoadingList] = useState(false)
  const panelRef     = useRef<HTMLDivElement>(null)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── 抓取警報列表 ──────────────────────────────────────────────
  const fetchAlerts = useCallback(async () => {
    try {
      setLoadingList(true)
      const res  = await fetch("/api/alerts?limit=30")
      if (!res.ok) return
      const data = await res.json() as { history: AlertRecord[] }
      setAlerts(data.history ?? [])

      // 計算未讀數：比 lastReadAt 更新的
      const unread = (data.history ?? []).filter(
        (a) => new Date(a.detected_at).getTime() > lastReadAt
      ).length
      setUnreadCount(unread)
    } catch {
      // 靜默失敗
    } finally {
      setLoadingList(false)
    }
  }, [lastReadAt])

  // ── 定時輪詢（30 秒）──────────────────────────────────────────
  // 即使 tab 打開，也保持同步
  useEffect(() => {
    fetchAlerts()
    pollRef.current = setInterval(fetchAlerts, 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchAlerts])

  // ── Service Worker 訊息（通知被點擊時）───────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "ALERT_NAVIGATE" && e.data.url) {
        fetchAlerts()  // 刷新列表
      }
    }
    navigator.serviceWorker?.addEventListener("message", handler)
    return () => navigator.serviceWorker?.removeEventListener("message", handler)
  }, [fetchAlerts])

  // ── 點擊外部關閉面板 ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // ── 開啟面板時標記已讀 ────────────────────────────────────────
  const handleOpen = () => {
    setOpen((v) => !v)
    if (!open) {
      setLastReadAt(Date.now())
      setUnreadCount(0)
    }
  }

  const handleNavigate = (raceNo: number) => {
    onNavigateToRace?.(raceNo)
    setOpen(false)
  }

  // ─── 鈴鐺按鈕 ────────────────────────────────────────────────
  const hasCritical = alerts.some((a) => a.severity === "CRITICAL" &&
    new Date(a.detected_at).getTime() > lastReadAt
  )

  return (
    <div className="relative" ref={panelRef}>
      {/* 鈴鐺按鈕 */}
      <button
        onClick={handleOpen}
        aria-label={`通知 ${unreadCount > 0 ? `(${unreadCount}條未讀)` : ""}`}
        className={`
          relative w-9 h-9 rounded-xl flex items-center justify-center
          transition-all hover:bg-slate-700/60 active:scale-90
          ${open ? "bg-slate-700/80" : ""}
        `}
      >
        {/* 鈴鐺 SVG */}
        <svg
          width="20" height="20" viewBox="0 0 24 24"
          fill={push.isSubscribed ? "currentColor" : "none"}
          stroke="currentColor" strokeWidth="2"
          className={`transition-colors ${
            push.isSubscribed ? "text-emerald-400" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          {!push.isSubscribed && (
            <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-500 opacity-70" />
          )}
        </svg>

        {/* 未讀數徽章 */}
        {unreadCount > 0 && (
          <span className={`
            absolute -top-0.5 -right-0.5 min-w-[16px] h-4
            flex items-center justify-center
            text-[9px] font-bold text-white rounded-full px-1
            ${hasCritical ? "bg-red-500 animate-bounce" : "bg-orange-500"}
          `}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* ── 下拉面板 ────────────────────────────────────────── */}
      {open && (
        <div className="
          absolute -right-2 sm:right-0 top-11 
          w-[calc(100vw-1rem)] sm:w-80 max-w-[360px] z-50
          bg-[#0d1421] border border-slate-700/60
          rounded-2xl shadow-2xl overflow-hidden
          animate-in fade-in slide-in-from-top-2 duration-150
        ">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              🏇 資金警報
              {loadingList && (
                <span className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
              )}
            </h3>
            {/* 訂閱開關 */}
            <button
              onClick={push.isSubscribed ? push.unsubscribe : push.subscribe}
              disabled={push.isLoading || !push.isSupported || push.permission === "denied"}
              className={`
                text-[11px] px-2.5 py-1 rounded-full font-semibold transition-all
                ${push.isSubscribed
                  ? "bg-emerald-900/50 text-emerald-400 border border-emerald-700/50 hover:bg-red-900/40 hover:text-red-400 hover:border-red-700/50"
                  : push.permission === "denied"
                  ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                  : "bg-slate-800 text-slate-400 border border-slate-600/50 hover:bg-emerald-900/30 hover:text-emerald-400"
                }
              `}
            >
              {push.isLoading    ? "處理中…"    :
               push.isSubscribed ? "✅ 已開啟"   :
               push.permission === "denied" ? "🔕 已封鎖" :
               "🔔 開啟通知"}
            </button>
          </div>

          {/* 授權提示（首次或未訂閱） */}
          {!push.isSubscribed && push.permission !== "granted" && (
            <PermissionPrompt
              permission={push.permission}
              isLoading={push.isLoading}
              error={push.error}
              isSupported={push.isSupported}
              onSubscribe={push.subscribe}
            />
          )}

          {/* 警報列表 */}
          <div className="overflow-y-auto max-h-[60vh]">
            {alerts.length === 0 ? (
              <EmptyAlertList />
            ) : (
              <div className="p-3 space-y-2">
                {alerts.map((alert) => (
                  <AlertItem
                    key={alert.alert_id}
                    alert={alert}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {alerts.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600 text-center">
              自動更新 · 每30秒 · 僅顯示今日警報
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export default NotificationBell
