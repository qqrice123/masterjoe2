// src/App.tsx

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AnalyticsDashboard } from "@/features/AnalyticsDashboard"
import { MoneyFlow } from "@/features/MoneyFlow/MoneyFlow"
import { NotificationBell } from "@/components/notifications/NotificationBell"
import { BarChart2, Activity, Lightbulb, History, Moon, Sun, RefreshCw, ChevronDown } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────

interface Meeting {
  id: string
  venue: string
  venueCode: string
  date: string
  totalRaces: number
}

// ── API fetch helpers ──────────────────────────────────────────────────────

const API = "/api"

async function fetchMeetings(): Promise<Meeting[]> {
  const res = await fetch(`${API}/meetings`)
  if (!res.ok) throw new Error("Failed to fetch meetings")
  return res.json()
}

async function fetchRaceDetail(venueCode: string, raceNo: number) { 
  const res = await fetch(`${API}/predict/${venueCode}/${raceNo}`) 
  if (!res.ok) { 
    const body = await res.json().catch(() => ({})) 
    const err: any = new Error(body.error ?? `HTTP ${res.status}`) 
    err.status = res.status 
    err.availableRaces = body.availableRaces   // ← use to jump to valid race 
    throw err 
  } 
  return res.json() 
}

// ── Tab config ─────────────────────────────────────────────────────────────

const TABS = [
  { id: "analysis",        label: "分析",   labelFull: "EV 分析",   icon: BarChart2 },
  { id: "moneyflow",       label: "資金",   labelFull: "資金追蹤",  icon: Activity  },
  { id: "recommendations", label: "建議",   labelFull: "AI 建議",   icon: Lightbulb },
  { id: "history",         label: "歷史",   labelFull: "賽事歷史",  icon: History   },
] as const

type TabId = (typeof TABS)[number]["id"]

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab]   = useState<TabId>("analysis")
  const [dark, setDark]             = useState(true)
  const [venueCode, setVenueCode]   = useState<string>("")
  const [raceNo, setRaceNo]         = useState<number>(1)
  const [maxRaces, setMaxRaces]     = useState<number>(11)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Apply dark/light theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light")
  }, [dark])

  // Meetings list
  const { data: meetings = [], isLoading: meetingsLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: fetchMeetings,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })

  // Auto-select first meeting
  useEffect(() => {
    if (meetings.length > 0 && !venueCode) {
      setVenueCode(meetings[0].venueCode)
      setMaxRaces(meetings[0].totalRaces || 11)
    }
  }, [meetings, venueCode])

  // Race detail (auto-refetch every 30s when autoRefresh is on)
  const { 
    data: raceDetail, 
    isLoading: raceLoading, 
    isFetching, 
    isError, 
    error: raceError, 
    refetch, 
    dataUpdatedAt, 
  } = useQuery({ 
    queryKey:  ["race", venueCode, raceNo], 
    queryFn:   () => fetchRaceDetail(venueCode, raceNo), 
    enabled:   !!venueCode && raceNo > 0, 
    refetchInterval: autoRefresh ? 30_000 : false, 
    staleTime: 25_000, 
    retry: (count, err: any) => { 
      // Don't retry 404s (race not found / no runners) 
      if (err?.status === 404) return false 
      return count < 2 
    }, 
  }) 

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null

  return (
    <div className="min-h-dvh bg-[#0f1117] text-slate-200 font-sans">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-[#0f1117]/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center gap-3">

          {/* Logo */}
          <div className="flex items-center gap-2 mr-2">
            <svg viewBox="0 0 32 32" width="28" height="28" aria-label="馬靈靈">
              <rect width="32" height="32" rx="7" fill="#3b82f6"/>
              <text x="16" y="22" fontSize="18" textAnchor="middle"
                fill="white" fontFamily="sans-serif" fontWeight="bold">馬</text>
            </svg>
            <span className="text-sm font-bold text-slate-100 hidden sm:block">馬靈靈</span>
          </div>

          {/* Meeting selector */}
          <div className="relative">
            <select
              value={venueCode}
              onChange={e => {
                setVenueCode(e.target.value)
                setRaceNo(1)
                const m = meetings.find(m => m.venueCode === e.target.value)
                if (m) setMaxRaces(m.totalRaces || 11)
              }}
              className="appearance-none cursor-pointer bg-slate-800/80 border border-slate-700 text-slate-200 text-sm rounded-lg pl-3 pr-10 py-1.5 focus:outline-none focus:border-blue-500 hover:border-slate-500 transition-colors shadow-sm bg-no-repeat"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9' /%3E%3C/svg%3E")`,
                backgroundPosition: "right 0.5rem center",
                backgroundSize: "1.5em 1.5em"
              }}
            >
              {meetingsLoading && <option>載入中...</option>}
              {meetings.map(m => (
                <option key={m.venueCode} value={m.venueCode}>
                  {m.venue} ({m.date})
                </option>
              ))}
            </select>
          </div>

          {/* Race number selector */}
          <div className="relative">
            <select
              value={raceNo}
              onChange={e => setRaceNo(Number(e.target.value))}
              className="appearance-none cursor-pointer bg-slate-800/80 border border-slate-700 text-slate-200 text-sm rounded-lg pl-3 pr-10 py-1.5 focus:outline-none focus:border-blue-500 hover:border-slate-500 transition-colors shadow-sm bg-no-repeat"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9' /%3E%3C/svg%3E")`,
                backgroundPosition: "right 0.5rem center",
                backgroundSize: "1.5em 1.5em"
              }}
            >
              {Array.from({ length: maxRaces }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>第 {n} 場</option>
              ))}
            </select>
          </div>

          {/* Race name (if loaded) */}
          {raceDetail && (
            <span className="hidden md:block text-xs text-slate-400 truncate max-w-[200px]">
              {raceDetail.raceName}
              {raceDetail.isPreRace && (
                <span className="ml-2 text-amber-500">夜賠估算</span>
              )}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Notification Bell */}
          <NotificationBell onNavigateToRace={(r) => setRaceNo(r)} />

          {/* Last updated */}
          {lastUpdated && (
            <span className="hidden sm:block text-xs text-slate-600">
              更新：{lastUpdated}
            </span>
          )}

          {/* Refresh indicator (Desktop) */}
          <button
            onClick={() => refetch()}
            className="hidden md:block p-2 text-slate-400 hover:text-blue-400 transition-all duration-200 active:scale-95 rounded-lg hover:bg-slate-800"
            aria-label="手動刷新"
          >
            <RefreshCw size={15} className={isFetching ? "animate-spin text-blue-400" : ""} />
          </button>

          {/* Auto-refresh toggle (Desktop) */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`hidden md:block text-xs px-2.5 py-1 rounded-full border transition-all duration-200 active:scale-95 shadow-sm ${
              autoRefresh
                ? "border-blue-600 text-blue-400 bg-blue-950/50 hover:bg-blue-900/60 hover:border-blue-500"
                : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 hover:bg-slate-800/50"
            }`}
          >
            {autoRefresh ? "自動 ON" : "自動 OFF"}
          </button>

          {/* Dark/Light toggle (Temporarily hidden) */}
          {/* <button
            onClick={() => setDark(v => !v)}
            className="p-2 text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800"
            aria-label="切換主題"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button> */}
        </div>
      </header>

      {/* ── Desktop Tab Bar ──────────────────────────────────────────── */}
      <div className="hidden md:block max-w-[1400px] mx-auto px-4 pt-4">
        <div className="flex gap-1 border-b border-slate-800">
          {TABS.map(({ id, labelFull, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-t-lg border-b-2 transition-all duration-300 active:scale-95 ${
                activeTab === id
                  ? "border-blue-500 text-blue-400 bg-slate-800/40 shadow-[0_1px_10px_rgba(59,130,246,0.2)]"
                  : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/20 hover:border-slate-700"
              }`}
            >
              <Icon size={14} className={`transition-transform duration-300 ${activeTab === id ? "scale-110" : ""}`} />
              {labelFull}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <main className="max-w-[1400px] mx-auto px-4 py-5 pb-24 md:pb-8 animate-[fadeIn_0.5s_ease-out]">

        {/* Race header info strip */}
        {raceDetail && (
          <div className="flex flex-wrap gap-3 mb-4 text-xs text-slate-500">
            <span className="text-slate-300 font-medium">
              {raceDetail.venueCode === "HV" ? "跑馬地" : "沙田"} · 第 {raceDetail.raceNumber} 場
            </span>
            <span>{raceDetail.distance}米</span>
            <span>{raceDetail.course}</span>
            <span>{raceDetail.going}</span>
            <span>{raceDetail.raceClass}</span>
            {raceDetail.postTime && (
              <span>
                {new Date(raceDetail.postTime).toLocaleTimeString("zh-HK", {
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
            )}
            <span className={`ml-auto font-semibold ${
              raceDetail.confidence === "HIGH" ? "text-emerald-400"
              : raceDetail.confidence === "MEDIUM" ? "text-amber-400"
              : "text-slate-500"
            }`}>
              系統置信度：
              {raceDetail.confidence === "HIGH" ? "🟢 高"
                : raceDetail.confidence === "MEDIUM" ? "🟡 中"
                : "🔴 低"}
            </span>
          </div>
        )}

        {/* Tab Content */}
        {activeTab === "analysis" && ( 
          <> 
            {isError && ( 
              <div className="flex flex-col items-center justify-center py-12 space-y-3"> 
                <span className="text-3xl">⚠️</span> 
                <p className="text-sm text-red-400"> 
                  {(raceError as any)?.message ?? "無法載入賽事資料"} 
                </p> 
                { /* Jump buttons if server told us which races are available */ } 
                {(raceError as any)?.availableRaces?.length > 0 && ( 
                  <div className="flex flex-wrap gap-2 mt-2"> 
                    <span className="text-xs text-slate-500">可用場次：</span> 
                    {((raceError as any).availableRaces as number[]).map(n => ( 
                      <button 
                        key={n} 
                        onClick={() => setRaceNo(n)} 
                        className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 
                                   text-slate-200 text-xs rounded-lg transition-colors" 
                      > 
                        第 {n} 場 
                      </button> 
                    ))} 
                  </div> 
                )} 
                <button 
                  onClick={() => refetch()} 
                  className="text-xs text-blue-400 hover:underline mt-1" 
                > 
                  重試 
                </button> 
              </div> 
            )} 
        
            {!isError && ( 
              <AnalyticsDashboard raceDetail={raceDetail} isLoading={raceLoading} /> 
            )} 
          </> 
        )}

{activeTab === "moneyflow" && (
          <MoneyFlow raceDetail={raceDetail ?? null} />
        )}
        {activeTab === "recommendations" && (
          <div className="space-y-4">
            {raceDetail?.aiSummary ? (
              <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  🤖 AI 系統建議
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed">{raceDetail.aiSummary}</p>
                {raceDetail.topPick && (
                  <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-3">
                    <span className="text-xs text-slate-500">首選：</span>
                    <span className="text-blue-400 font-bold text-lg">
                      #{raceDetail.topPick.runnerNumber}
                    </span>
                    <span className="text-slate-300">{raceDetail.topPick.runnerName}</span>
                    <span className="text-xs text-slate-500 ml-auto">
                      模型賠率 {raceDetail.topPick.modelOdds}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-20 text-slate-600 text-sm">
                {raceLoading ? "載入中..." : "選擇賽事以獲取 AI 建議"}
              </div>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="flex items-center justify-center py-20 text-slate-600 text-sm">
            歷史記錄（需要 Neon 數據積累後啟用）
          </div>
        )}
      </main>

      {/* ── Mobile Floating Controls ─────────────────────────────────── */}
      <div className="md:hidden fixed bottom-20 right-4 z-40 flex flex-col gap-3 items-end">
        {/* Mobile Refresh Button */}
        <button
          onClick={() => refetch()}
          className="p-3 bg-slate-800/90 backdrop-blur border border-slate-700 text-slate-300 rounded-full shadow-lg transition-all active:scale-95 flex items-center justify-center"
          aria-label="手動刷新"
        >
          <RefreshCw size={20} className={isFetching ? "animate-spin text-blue-400" : ""} />
        </button>

        {/* Mobile Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh(v => !v)}
          className={`flex items-center justify-center w-12 h-12 rounded-full border shadow-lg backdrop-blur transition-all duration-200 active:scale-95 ${
            autoRefresh
              ? "border-blue-500/50 text-blue-400 bg-blue-950/90"
              : "border-slate-700/50 text-slate-400 bg-slate-800/90"
          }`}
        >
          <div className="flex flex-col items-center justify-center leading-none">
            <span className="text-[10px] font-medium opacity-80 mb-0.5">自動</span>
            <span className="text-xs font-bold">{autoRefresh ? 'ON' : 'OFF'}</span>
          </div>
        </button>
      </div>

      {/* ── Mobile Bottom Tab Bar ────────────────────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[#0f1117]/95 backdrop-blur border-t border-slate-800">
        <div className="grid grid-cols-4 h-16">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center justify-center gap-1 text-xs transition-colors ${
                activeTab === id ? "text-blue-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon size={20} />
              {label}
            </button>
          ))}
        </div>
      </nav>

    </div>
  )
}
