// src/App.tsx

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AnalyticsDashboard } from "@/features/AnalyticsDashboard"
import { MoneyFlow } from "@/features/MoneyFlow/MoneyFlow"
import { BarChart2, Activity, Lightbulb, History, Moon, Sun, RefreshCw } from "lucide-react"

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
            <svg viewBox="0 0 32 32" width="28" height="28" aria-label="Master Joe Racing">
              <rect width="32" height="32" rx="7" fill="#3b82f6"/>
              <text x="16" y="22" fontSize="18" textAnchor="middle"
                fill="white" fontFamily="sans-serif" fontWeight="bold">馬</text>
            </svg>
            <span className="text-sm font-bold text-slate-100 hidden sm:block">Master Joe Racing</span>
          </div>

          {/* Meeting selector */}
          <select
            value={venueCode}
            onChange={e => {
              setVenueCode(e.target.value)
              setRaceNo(1)
              const m = meetings.find(m => m.venueCode === e.target.value)
              if (m) setMaxRaces(m.totalRaces || 11)
            }}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
          >
            {meetingsLoading && <option>載入中...</option>}
            {meetings.map(m => (
              <option key={m.venueCode} value={m.venueCode}>
                {m.venue} ({m.date})
              </option>
            ))}
          </select>

          {/* Race number selector */}
          <select
            value={raceNo}
            onChange={e => setRaceNo(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
          >
            {Array.from({ length: maxRaces }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>第 {n} 場</option>
            ))}
          </select>

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

          {/* Last updated */}
          {lastUpdated && (
            <span className="hidden sm:block text-xs text-slate-600">
              更新：{lastUpdated}
            </span>
          )}

          {/* Refresh indicator */}
          <button
            onClick={() => refetch()}
            className="p-2 text-slate-400 hover:text-blue-400 transition-colors rounded-lg hover:bg-slate-800"
            aria-label="手動刷新"
          >
            <RefreshCw size={15} className={isFetching ? "animate-spin text-blue-400" : ""} />
          </button>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              autoRefresh
                ? "border-blue-600 text-blue-400 bg-blue-950/50"
                : "border-slate-700 text-slate-500"
            }`}
          >
            {autoRefresh ? "自動 ON" : "自動 OFF"}
          </button>

          {/* Dark/Light toggle */}
          <button
            onClick={() => setDark(v => !v)}
            className="p-2 text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800"
            aria-label="切換主題"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      {/* ── Desktop Tab Bar ──────────────────────────────────────────── */}
      <div className="hidden md:block max-w-[1400px] mx-auto px-4 pt-4">
        <div className="flex gap-1 border-b border-slate-800">
          {TABS.map(({ id, labelFull, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-t-lg border-b-2 transition-colors ${
                activeTab === id
                  ? "border-blue-500 text-blue-400 bg-slate-800/40"
                  : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/20"
              }`}
            >
              <Icon size={14} />
              {labelFull}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <main className="max-w-[1400px] mx-auto px-4 py-5 pb-24 md:pb-8">

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
