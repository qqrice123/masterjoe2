// public/sw.js
// Service Worker — 接收 Web Push，顯示系統通知
// 即使瀏覽器最小化或 tab 關閉，OS 仍會彈出通知橫幅
// ─────────────────────────────────────────────────────────────

const APP_URL = self.location.origin

// ── Push 事件：伺服器推送到達 ─────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: "Master Joe Racing", body: event.data.text() }
  }

  const {
    title   = "🏇 Master Joe Racing",
    body    = "",
    icon    = "/icon-192.png",
    badge   = "/badge-72.png",
    tag     = "masterjoe-alert",
    data    = {},
  } = payload

  // 嚴重度對應不同顏色 icon（可選）
  const severityIcon = {
    CRITICAL: "/icon-alert-critical.png",
    HIGH:     "/icon-alert-high.png",
    MEDIUM:   "/icon-192.png",
  }[data.severity ?? "MEDIUM"] ?? icon

  const options = {
    body,
    icon:              severityIcon,
    badge,
    tag,                          // 同 tag 的通知會合並，不會刷屏
    renotify:          true,      // 即使同 tag 也重新彈出
    requireInteraction: data.severity === "CRITICAL",  // CRITICAL 要求用戶主動關閉
    vibrate:           data.severity === "CRITICAL" ? [200, 100, 200] : [100],
    timestamp:         Date.now(),
    data: {
      url:      data.url ?? APP_URL,
      alertId:  data.alertId,
      raceNo:   data.raceNo,
      severity: data.severity,
    },
    actions: [
      { action: "open",    title: "📊 查看分析" },
      { action: "dismiss", title: "關閉" },
    ],
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

// ── notificationclick：用戶點擊通知 ──────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  if (event.action === "dismiss") return

  const targetUrl = event.notification.data?.url ?? APP_URL

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 如果 App 已開啟，切換到對應 tab
      for (const client of clientList) {
        if (client.url.startsWith(APP_URL) && "focus" in client) {
          client.focus()
          client.postMessage({ type: "ALERT_NAVIGATE", url: targetUrl })
          return
        }
      }
      // 否則開新 tab
      if (clients.openWindow) return clients.openWindow(targetUrl)
    })
  )
})

// ── 安裝 & 激活（基本 lifecycle）──────────────────────────────
self.addEventListener("install",  () => self.skipWaiting())
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()))
