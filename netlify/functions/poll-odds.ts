/**
 * poll-odds.ts
 * ============
 * Netlify Function — 被 GitHub Actions 每 5 分鐘呼叫一次
 * 1. 用 hkjc-api 抓取全場現在賠率
 * 2. 寫入 Neon odds_snapshots 表（已容錯重複快照）
 *
 */
import type { Config } from "@netlify/functions"
import { neon } from "@neondatabase/serverless"
import { HorseRacingAPI, HKJCClient } from "hkjc-api"
import { horseOddsQuery, horsePoolQuery } from "hkjc-api/dist/query/horseRacingQuery.js"

const sql = neon(process.env.DATABASE_URL!)

// ---- 輔助函數 ----

/** 將 HKJC meeting.date 轉為 DATE 字串 YYYY-MM-DD */
function toISODate(hkjcDate: string): string {
  const d = hkjcDate.replace(/[\/\-]/g, "")
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

/** 計算距開飛分鐘數（負數 = 未開飛）*/
function minutesToPost(postTime: string | undefined): number {
  if (!postTime) return -999
  try {
    let postMs: number
    // 若為 HH:mm 格式（例如 "12:30"）
    if (/^\d{1,2}:\d{2}$/.test(postTime)) {
      const [h, m] = postTime.split(":").map(Number)
      const d = new Date()
      d.setHours(h, m, 0, 0)
      postMs = d.getTime()
    } else {
      // 假設為完整 ISO 時間字串
      postMs = new Date(postTime).getTime()
    }
    
    if (isNaN(postMs)) return -999
    
    const now = new Date().getTime()
    const result = Math.round((postMs - now) / 60000)
    return isNaN(result) ? -999 : result
  } catch {
    return -999
  }
}

/** 將 mtp 映射至 bucket（對應 DB CHECK constraint）*/
function getMtpBucket(mtp: number): number {
  if (mtp > 60) return 90
  if (mtp > 30) return 60
  if (mtp > 15) return 30
  if (mtp > 5)  return 15
  if (mtp > 3)  return 5
  if (mtp > 0)  return 3
  return 0
}

// ---- 主 handler ----
export default async (req: Request) => {
  const url = new URL(req.url)
  // 允許使用特定參數來繞過 MTP 限制，方便手動觸發測試
  const forceMtp = url.searchParams.get('force') === 'true'

  if (!process.env.DATABASE_URL) {
    console.error("[poll-odds] DATABASE_URL 未設定")
    return new Response(JSON.stringify({ error: "DATABASE_URL missing" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }

  const horseAPI = new HorseRacingAPI()
  const hkjcClient = new HKJCClient()
  let totalInserted = 0
  const errors: string[] = []

  try {
    const meetings = await horseAPI.getAllRaces()
    if (!meetings || meetings.length === 0) {
      console.log("[poll-odds] 無活躍賽事日")
      return new Response(JSON.stringify({ inserted: 0, message: "無活躍賽事日" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    }

    for (const meeting of meetings) {
      const raceDate = toISODate(meeting.date)
      const venue = (meeting.venueCode as string).toUpperCase().slice(0, 2)
      const races = meeting.races || []

      for (const race of races) {
        const raceNo = parseInt(race.no)
        if (isNaN(raceNo)) continue

        const mtp = minutesToPost(race.postTime)
        if (isNaN(mtp)) continue
        // 為了確保可以抓取所有賽事（即使是未來或剛結束的），當 forceMtp 為 true 時放寬限制
        if (!forceMtp && (mtp < -15 || mtp > 120)) {
          // console.log(`[poll-odds] 跳過 ${venue} R${raceNo} (MTP: ${mtp})`)
          continue
        }

        const mtpBucket = getMtpBucket(mtp)
        const safeMtp = Math.max(-32768, Math.min(32767, mtp)) // smallint range

        let oddsNodes: Array<{ combString: string; oddsValue: string }> = []
        let qinOddsNodes: Array<{ combString: string; oddsValue: string }> = []
        let qplOddsNodes: Array<{ combString: string; oddsValue: string }> = []
        
        let winPoolInv = 28000000
        let qinPoolInv = 20000000
        let qplPoolInv = 15000000

        try {
          const oddsResponse: any = await hkjcClient.request(horseOddsQuery, {
            date: meeting.date,
            venueCode: meeting.venueCode,
            raceNo,
            oddsTypes: ["WIN", "QIN", "QPL"],
          })
          const pools = oddsResponse.raceMeetings?.[0]?.pmPools || []
          oddsNodes = pools.find((p: any) => p.oddsType === "WIN")?.oddsNodes || []
          qinOddsNodes = pools.find((p: any) => p.oddsType === "QIN")?.oddsNodes || []
          qplOddsNodes = pools.find((p: any) => p.oddsType === "QPL")?.oddsNodes || []

          const poolResponse: any = await hkjcClient.request(horsePoolQuery, {
            date: meeting.date,
            venueCode: meeting.venueCode,
            raceNo,
            oddsTypes: ["WIN", "QIN", "QPL"],
          })
          const poolInvs = poolResponse.raceMeetings?.[0]?.poolInvs || []
          winPoolInv = Number(poolInvs.find((p: any) => p.oddsType === "WIN")?.investment || winPoolInv)
          qinPoolInv = Number(poolInvs.find((p: any) => p.oddsType === "QIN")?.investment || qinPoolInv)
          qplPoolInv = Number(poolInvs.find((p: any) => p.oddsType === "QPL")?.investment || qplPoolInv)
        } catch (e: any) {
          errors.push(`賠率抓取失敗 ${venue} R${raceNo}: ${e?.message}`)
          continue
        }

        if (oddsNodes.length === 0) continue

        // 計算聰明錢 (SMART_MONEY)
        const DEDUCT = 0.825
        let bestSmartMoneyRunner: string | null = null
        let maxSmartMoneyRatio = 0

        const runnersMap: Record<string, string> = {}
        const runners = race.runners || []
        for (const r of runners) {
          const key = String(r.no).padStart(2, "0")
          runnersMap[key] = r.name_ch || r.name_en || ""

          if (String(r.no).startsWith("R") || String(r.no).toLowerCase().includes("standby") || String(r.no).includes("後備")) continue

          const winOddsObj = oddsNodes.find(n => n.combString === key)
          if (!winOddsObj) continue
          const winOdds = parseFloat(winOddsObj.oddsValue)
          if (isNaN(winOdds) || winOdds <= 0) continue

          const estWin = (winPoolInv * DEDUCT) / winOdds

          let qinSum = 0
          for (const node of qinOddsNodes) {
            const odds = parseFloat(node.oddsValue)
            if (odds > 0) {
              const parts = node.combString.split(",").map(x => x.padStart(2, "0"))
              if (parts.includes(key)) qinSum += (qinPoolInv * DEDUCT) / odds
            }
          }

          let qplSum = 0
          for (const node of qplOddsNodes) {
            const odds = parseFloat(node.oddsValue)
            if (odds > 0) {
              const parts = node.combString.split(",").map(x => x.padStart(2, "0"))
              if (parts.includes(key)) qplSum += (qplPoolInv * DEDUCT) / odds
            }
          }

          if (estWin > 0 && (estWin + qinSum + qplSum) > 5000) {
            const ratio = (qinSum + qplSum) / estWin
            if (ratio > maxSmartMoneyRatio) {
              maxSmartMoneyRatio = ratio
              bestSmartMoneyRunner = key
            }
          }
        }
        
        // 取得前一次快照 (用於計算跌幅與估算注入金額)
        // 不再限制 mtp_bucket 必須大於當前，而是直接抓取該馬匹「最新的一筆」快照紀錄
        let prevOddsMap: Record<string, number> = {}
        try {
          const prevSnapshots = await sql`
            SELECT DISTINCT ON (runner_number) runner_number, odds 
            FROM odds_snapshots 
            WHERE date = ${raceDate} AND venue = ${venue} AND race_no = ${raceNo}
            ORDER BY runner_number, snaptime DESC
          `
          prevSnapshots.forEach(row => {
            if (!prevOddsMap[row.runner_number]) {
              prevOddsMap[row.runner_number] = parseFloat(row.odds)
            }
          })
          // console.log(`[poll-odds] ${venue} R${raceNo} 找到 ${Object.keys(prevOddsMap).length} 筆歷史賠率`)
        } catch (e) {
          console.error("取得歷史賠率失敗", e)
        }

        const newAlerts: any[] = []
        const largeBetsTransactions: any[] = []

        // 合併 WIN, QIN, QPL 節點來處理大戶邏輯
        const allOddsNodes = [
          ...oddsNodes.map(n => ({ ...n, type: "WIN", poolInv: winPoolInv })),
          ...qinOddsNodes.map(n => ({ ...n, type: "QIN", poolInv: qinPoolInv })),
          ...qplOddsNodes.map(n => ({ ...n, type: "QPL", poolInv: qplPoolInv }))
        ]

        try {
          const queries: any[] = []
          
          allOddsNodes.forEach((node) => {
            const paddedNo = String(node.combString).split(",").map(x => x.padStart(2, "0")).join(",")
            const isWin = node.type === "WIN"
            const horseName = isWin ? (runnersMap[paddedNo] || runnersMap[node.combString] || "") : ""
            const odds = parseFloat(node.oddsValue)
            if (isNaN(odds)) return null

            // 警報偵測邏輯
            const prevOdds = prevOddsMap[paddedNo] || prevOddsMap[node.combString]
            let dropPct: number | null = null
            let isLargeBet = false
            let injectedAmount = 0
            
            if (prevOdds && prevOdds > 0) {
              dropPct = ((prevOdds - odds) / prevOdds) * 100
              
              // 估算注入金額: (目前彩池 * 0.825 / 目前賠率) - (目前彩池 * 0.825 / 之前賠率)
              // 這是一個近似值，假設彩池總額變化不大時的單注注入量
              const currentEst = (node.poolInv * 0.825) / odds
              const prevEst = (node.poolInv * 0.825) / prevOdds
              injectedAmount = Math.max(0, currentEst - prevEst)

              // 判斷是否為大戶大注: 賠率跌幅 >= 20% 或 單次注入金額 >= 20萬
              if (dropPct >= 20 || injectedAmount >= 200000) {
                isLargeBet = true
              }
            }
            
            const snaptime = new Date().toISOString()
            const timeStr = new Date().toLocaleTimeString("en-HK", { timeZone: "Asia/Hong_Kong", hour12: false, hour: "2-digit", minute: "2-digit" })
            
            // 如果是大注，記錄到 largeBetsTransactions
            if (isLargeBet && odds > 0) {
              largeBetsTransactions.push({
                type: node.type,
                time: timeStr,
                runnerNumbers: paddedNo.split(","),
                odds: odds,
                amount: Math.round(injectedAmount || ((node.poolInv * 0.825) / odds)), // 若無歷史資料則取當前估算
                isAlert: true
              })
            }

            // 只有 WIN 才會觸發舊版的 alerts 和 push-send (避免 QIN/QPL 產生過多推播)
            if (isWin && (isLargeBet || paddedNo === bestSmartMoneyRunner)) {
              const isSM = paddedNo === bestSmartMoneyRunner
              const alertType = isLargeBet ? "LARGE_BET" : "SMART_MONEY"
              const alertId = `${raceDate}_${venue}_${raceNo}_${paddedNo}_${mtpBucket}_${alertType}`
              const severity = isLargeBet ? (dropPct && dropPct >= 35 ? "CRITICAL" : "HIGH") : "HIGH"
              newAlerts.push({
                alertId,
                venue,
                raceNo,
                raceName: race.raceName_ch || race.raceName_en || "",
                runnerNumber: paddedNo,
                runnerName: horseName,
                alertType,
                severity,
                prevOdds,
                currentOdds: odds,
                dropPct: isSM ? maxSmartMoneyRatio : (dropPct || 0), // SMART_MONEY 將 Ratio 存在 dropPct 欄位
              })

              // 記錄寫入 Alert 的 Query
              queries.push(sql`
                INSERT INTO alerts (alert_id, venue, race_no, race_name, runner_number, runner_name, alert_type, severity, prev_odds, current_odds, drop_pct, date)
                VALUES (${alertId}, ${venue}, ${raceNo}, ${race.raceName_ch || race.raceName_en || ""}, ${paddedNo}, ${horseName}, ${alertType}, ${severity}, ${prevOdds}, ${odds}, ${isSM ? maxSmartMoneyRatio : dropPct}, ${raceDate})
                ON CONFLICT (alert_id) DO NOTHING
              `)
            }

            // 一般的賠率快照更新 (WIN, QIN, QPL 都存入 odds_snapshots 以便下次比對)
            queries.push(sql`
              INSERT INTO odds_snapshots
                (date, venue, race_no, runner_number, horse_name, odds, minutes_to_post, mtp_bucket, snaptime)
              VALUES
                (${raceDate}, ${venue}, ${raceNo}, ${paddedNo}, ${horseName}, ${odds}, ${safeMtp}, ${mtpBucket}, ${snaptime})
              ON CONFLICT (date, venue, race_no, runner_number, mtp_bucket) 
              DO UPDATE SET odds = EXCLUDED.odds, minutes_to_post = EXCLUDED.minutes_to_post, snaptime = EXCLUDED.snaptime
            `)
          })

          // 處理 large_bets 大戶寫入
          if (largeBetsTransactions.length > 0) {
            largeBetsTransactions.forEach(tx => {
              queries.push(sql`
                INSERT INTO large_bets (venue, race_no, date, type, time, runner_numbers, odds, amount, is_alert)
                SELECT ${venue}, ${raceNo}, ${raceDate}, ${tx.type}, ${tx.time}, ${JSON.stringify(tx.runnerNumbers)}::jsonb, ${tx.odds}, ${tx.amount}, ${tx.isAlert}
                WHERE NOT EXISTS (
                  SELECT 1 FROM large_bets 
                  WHERE venue = ${venue} AND race_no = ${raceNo} AND date = ${raceDate} 
                  AND type = ${tx.type} AND time = ${tx.time} AND amount = ${tx.amount}
                )
              `)
            })
          }

          if (queries.length > 0) {
            await sql.transaction(queries)
            totalInserted += queries.length
          }
          
          // 如果有新的警報，觸發 push-send
          if (newAlerts.length > 0 && process.env.CRON_SECRET) {
            try {
              const baseUrl = process.env.URL || (process.env.SITE_NAME ? `https://${process.env.SITE_NAME}.netlify.app` : "http://localhost:8888")
              const url = `${baseUrl}/.netlify/functions/api/push-send`
              
              const highestAlert = newAlerts.sort((a, b) => (b.dropPct || 0) - (a.dropPct || 0))[0]
              
              await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${process.env.CRON_SECRET}`
                },
                body: JSON.stringify({
                  title: `大戶落飛 🚨 R${highestAlert.raceNo} #${highestAlert.runnerNumber}`,
                  body: `${highestAlert.runnerName} 賠率由 ${highestAlert.prevOdds} 跌至 ${highestAlert.currentOdds} (↓${highestAlert.dropPct.toFixed(1)}%)`,
                  url: `/?venue=${highestAlert.venue}&race=${highestAlert.raceNo}`,
                })
              })
              console.log(`[poll-odds] 觸發了 ${newAlerts.length} 個警報推播`)
            } catch (err) {
              console.error("[poll-odds] 觸發推播失敗", err)
            }
          }
        } catch (e: any) {
          errors.push(`Neon 寫入失敗 ${venue} R${raceNo}: ${e?.message}`)
        }
      }
    }

    console.log(`[poll-odds] 完成: 寫入 ${totalInserted} 筆賠率快照`)
    
    // 清除舊資料 (保留今日與昨日，避免跨夜賽事被刪除)
    try {
      await sql`DELETE FROM alerts WHERE date < CURRENT_DATE - INTERVAL '1 day'`
      await sql`DELETE FROM odds_snapshots WHERE date < CURRENT_DATE - INTERVAL '2 days'`
      // console.log("[poll-odds] 成功清理舊資料")
    } catch (cleanErr) {
      console.error("[poll-odds] 清理舊資料失敗", cleanErr)
    }

    return new Response(
      JSON.stringify({
        inserted: totalInserted,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  } catch (e: any) {
    console.error("[poll-odds] 差錢錯誤:", e)
    return new Response(
      JSON.stringify({ error: e?.message || "unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}

export const config: Config = {
  schedule: "*/5 * * * *"
}
