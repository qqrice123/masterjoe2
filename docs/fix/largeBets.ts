// src/services/largeBets.ts
// 大戶落飛數據接入層
// 解析格式: Time | Selection | Odds | Amount | Y(alert)
//
// 資料來源選項:
//   A. 輪詢後端 REST endpoint (推薦)
//   B. WebSocket 實時推送
//   C. 手動貼入文字解析

// ─── Types ────────────────────────────────────────────────────────────────────

export type BetType = "WIN" | "QIN" | "QPL"

export interface LargeBetTransaction {
  time:      string    // "12:05"
  selection: string    // "9" (WIN) or "5-9" (QIN/QPL)
  odds:      number
  amount:    number    // HKD
  isAlert:   boolean   // Y flag
  betType:   BetType
  runners:   number[]  // [9] or [5, 9]
}

// Per-runner aggregated money flow (feeds into Prediction fields)
export interface RunnerMoneyFlow {
  runnerNumber:      number
  totalWin:          number   // sum of WIN amounts → estWinInvestment
  totalQIN:          number   // sum of QIN amounts where runner appears
  totalQPL:          number   // sum of QPL amounts where runner appears
  alertCount:        number   // how many Y transactions
  latestAlertOdds:   number | null
  transactions:      LargeBetTransaction[]
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse one tab-separated row.
 * Handles both WIN rows ("9") and combination rows ("5-9").
 * betType is passed explicitly because WIN/QIN/QPL are in separate columns
 * in the source data but merged here for processing.
 */
export function parseLargeBetRow(
  row:     string,
  betType: BetType,
): LargeBetTransaction | null {
  const cols = row.trim().split(/\t/)
  if (cols.length < 4) return null

  const time      = cols[0].trim()
  const selection = cols[1].trim()
  const odds      = parseFloat(cols[2])
  const amount    = parseInt(cols[3], 10)
  const isAlert   = (cols[4]?.trim() ?? "") === "Y"

  if (!time || !selection || isNaN(odds) || isNaN(amount)) return null

  const runners = selection.includes("-")
    ? selection.split("-").map(Number).filter(n => !isNaN(n))
    : [parseInt(selection, 10)].filter(n => !isNaN(n))

  return { time, selection, odds, amount, isAlert, betType, runners }
}

/**
 * Parse the full pasted block.
 * The raw data has 4 column groups: WIN | WIN | QIN | QPL
 * Each group: Time, Selection, Odds, Amount, Y?
 */
export function parseFullDataBlock(rawText: string): LargeBetTransaction[] {
  const GROUP_WIDTH = 5  // cols per group (Time, Sel, Odds, Amt, Y)
  const GROUP_TYPES: BetType[] = ["WIN", "WIN", "QIN", "QPL"]
  const results: LargeBetTransaction[] = []

  const lines = rawText.trim().split("\n")
  for (const line of lines) {
    const cols = line.split(/\t/)
    GROUP_TYPES.forEach((betType, g) => {
      const start = g * GROUP_WIDTH
      if (start >= cols.length) return
      const chunk = cols.slice(start, start + GROUP_WIDTH).join("\t")
      const tx = parseLargeBetRow(chunk, betType)
      if (tx) results.push(tx)
    })
  }
  return results
}

/**
 * Aggregate transactions into per-runner money flow.
 */
export function aggregateByRunner(
  txns: LargeBetTransaction[],
): Map<number, RunnerMoneyFlow> {
  const map = new Map<number, RunnerMoneyFlow>()

  const get = (n: number): RunnerMoneyFlow =>
    map.get(n) ?? {
      runnerNumber: n,
      totalWin: 0, totalQIN: 0, totalQPL: 0,
      alertCount: 0, latestAlertOdds: null,
      transactions: [],
    }

  for (const tx of txns) {
    for (const runner of tx.runners) {
      const r = get(runner)
      if (tx.betType === "WIN") r.totalWin += tx.amount
      if (tx.betType === "QIN") r.totalQIN += tx.amount
      if (tx.betType === "QPL") r.totalQPL += tx.amount
      if (tx.isAlert) {
        r.alertCount++
        r.latestAlertOdds = tx.odds
      }
      r.transactions.push(tx)
      map.set(runner, r)
    }
  }
  return map
}

// ─── Bridge: merge into existing Prediction array ─────────────────────────────

import type { Prediction } from "./api"

export function mergeLargeBetsIntoPredictions(
  predictions: Prediction[],
  txns:         LargeBetTransaction[],
): Prediction[] {
  const flow = aggregateByRunner(txns)

  return predictions.map(p => {
    const runnerNum = parseInt(String(p.runnerNumber), 10)
    const f = flow.get(runnerNum)
    if (!f) return p

    const qinWinRatio = f.totalWin > 0 ? (f.totalQIN + f.totalQPL) / f.totalWin : 0

    return {
      ...p,
      estWinInvestment: (p.estWinInvestment ?? 0) + f.totalWin,
      estQINInvestment: (p.estQINInvestment ?? 0) + f.totalQIN,
      estQPLInvestment: (p.estQPLInvestment ?? 0) + f.totalQPL,
      // Override moneyAlert if large-bet threshold triggered
      moneyAlert: f.alertCount >= 2
        ? "large_bet"
        : qinWinRatio > 3.0
          ? "qin_overflow"
          : p.moneyAlert,
    }
  })
}

// ─── Option A: REST polling ───────────────────────────────────────────────────
// Backend endpoint: GET /api/large-bets?venue=ST&raceNo=6
// Returns: { transactions: LargeBetTransaction[] }

export async function fetchLargeBets(
  venue:  string,
  raceNo: number,
): Promise<LargeBetTransaction[]> {
  const res = await fetch(`/api/large-bets?venue=${venue}&raceNo=${raceNo}`)
  if (!res.ok) throw new Error(`fetchLargeBets: ${res.status}`)
  const data = await res.json() as { transactions: LargeBetTransaction[] }
  return data.transactions
}

// ─── Option B: WebSocket hook ────────────────────────────────────────────────
// Usage in component:
//   const txns = useLargeBetSocket("ST", 6)

import { useState, useEffect, useRef } from "react"

export function useLargeBetSocket(
  venue:  string,
  raceNo: number,
): LargeBetTransaction[] {
  const [txns, setTxns] = useState<LargeBetTransaction[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(
      `wss://your-backend/ws/large-bets?venue=${venue}&raceNo=${raceNo}`
    )
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as
          | { type: "snapshot"; data: LargeBetTransaction[] }
          | { type: "append";   data: LargeBetTransaction   }

        if (msg.type === "snapshot") {
          setTxns(msg.data)
        } else if (msg.type === "append") {
          setTxns(prev => [...prev, msg.data])
        }
      } catch { /* ignore malformed */ }
    }

    ws.onerror = () => console.warn("[LargeBets WS] error")
    return () => ws.close()
  }, [venue, raceNo])

  return txns
}

// ─── Option C: Manual paste parser (no backend needed) ───────────────────────
// Usage: call parseFullDataBlock(pastedText) directly in the UI

export { parseFullDataBlock as parsePastedLargeBets }
