// netlify/functions/api/push-send.ts
import webpush from "web-push"
import { neon } from "@neondatabase/serverless"

// 設定 VAPID Keys
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""
const privateKey = process.env.VAPID_PRIVATE_KEY || ""
const subject = process.env.VAPID_SUBJECT || "mailto:admin@masterjoe.app"

if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey)
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  }
}

export async function POST(event: any) {
  // 驗證內部呼叫用的 Secret Key (避免被惡意觸發)
  const authHeader = event.headers.authorization
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`
  
  if (!process.env.CRON_SECRET || authHeader !== expectedToken) {
    return json(401, { error: "Unauthorized" })
  }

  if (!process.env.DATABASE_URL) {
    return json(500, { error: "DATABASE_URL not configured" })
  }

  if (!publicKey || !privateKey) {
    return json(500, { error: "VAPID keys not configured" })
  }

  try {
    const payload = JSON.parse(event.body || "{}")
    // payload 應包含: title, body, url, icon, tag 等
    const notificationPayload = JSON.stringify({
      title: payload.title || "馬靈靈 新警報",
      body: payload.body || "有新的異常資金警報！",
      url: payload.url || "/",
      icon: payload.icon || "/icons/icon-192x192.png",
      tag: payload.tag || "alert", // 同樣 tag 的通知會覆蓋舊的
      vibrate: payload.vibrate || [200, 100, 200]
    })

    const sql = neon(process.env.DATABASE_URL)
    
    // 獲取所有訂閱
    const subscriptions = await sql`SELECT * FROM push_subscriptions`
    
    if (subscriptions.length === 0) {
      return json(200, { success: true, message: "No active subscriptions" })
    }

    const sendPromises = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          auth: sub.auth,
          p256dh: sub.p256dh
        }
      }

      try {
        await webpush.sendNotification(pushSubscription, notificationPayload)
        return { success: true, endpoint: sub.endpoint }
      } catch (error: any) {
        // 如果訂閱已經失效或被使用者移除 (410 Gone 或 404 Not Found)
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log(`Subscription expired, removing: ${sub.endpoint}`)
          await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`
        }
        return { success: false, endpoint: sub.endpoint, error: error.message }
      }
    })

    const results = await Promise.all(sendPromises)
    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    return json(200, { 
      success: true, 
      sent: successCount,
      failed: failCount,
      results 
    })

  } catch (error: any) {
    console.error("Failed to send push notifications:", error)
    return json(500, { error: "Internal server error", detail: error.message })
  }
}