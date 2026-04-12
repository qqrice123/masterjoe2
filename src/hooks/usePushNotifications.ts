// hooks/usePushNotifications.ts
// 管理 Web Push 訂閱的完整 React Hook
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react"

export type PermissionState = "default" | "granted" | "denied" | "unsupported"

export interface PushNotificationState {
  /** 瀏覽器是否支援 Web Push */
  isSupported:  boolean
  /** 目前授權狀態 */
  permission:   PermissionState
  /** 是否已訂閱並儲存到伺服器 */
  isSubscribed: boolean
  /** 操作中（訂閱/取消） */
  isLoading:    boolean
  /** 最後一個錯誤訊息 */
  error:        string | null
  /** 請求授權並訂閱 */
  subscribe:    () => Promise<void>
  /** 取消訂閱 */
  unsubscribe:  () => Promise<void>
}

// VAPID Public Key（從 .env 讀取，並透過 Vite define 注入）
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding  = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64   = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData  = window.atob(base64)
  const output   = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    // 等待 SW 激活
    await navigator.serviceWorker.ready
    return reg
  } catch (err) {
    console.error("[SW] 註冊失敗:", err)
    return null
  }
}

export function usePushNotifications(): PushNotificationState {
  const [isSupported,  setIsSupported]  = useState(false)
  const [permission,   setPermission]   = useState<PermissionState>("default")
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading,    setIsLoading]    = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  // 初始化：檢查支援度 + 現有訂閱狀態
  useEffect(() => {
    const check = async () => {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager"   in window   &&
        "Notification"  in window

      setIsSupported(supported)
      if (!supported) {
        setPermission("unsupported")
        return
      }

      setPermission(Notification.permission as PermissionState)

      // 檢查是否已有訂閱
      const reg = await navigator.serviceWorker.ready.catch(() => null)
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        setIsSubscribed(!!sub)
      }
    }
    check()
  }, [])

  // 訂閱
  const subscribe = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      if (!VAPID_PUBLIC_KEY) throw new Error("VAPID key 未設定，請在 .env.local 加入 NEXT_PUBLIC_VAPID_PUBLIC_KEY")

      // 1. 請求通知授權
      const result = await Notification.requestPermission()
      setPermission(result as PermissionState)
      if (result !== "granted") throw new Error("用戶拒絕了通知授權")

      // 2. 註冊 Service Worker
      const reg = await registerServiceWorker()
      if (!reg) throw new Error("Service Worker 註冊失敗")

      // 3. 建立 Push 訂閱
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as any,
      })

      // 4. 儲存到伺服器（Neon DB）
      const res = await fetch("/api/push-subscribe", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error(`伺服器錯誤: ${res.status}`)

      setIsSubscribed(true)
      console.log("[Push] 訂閱成功")

    } catch (err: any) {
      setError(err.message ?? String(err))
      console.error("[Push] 訂閱失敗:", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 取消訂閱
  const unsubscribe = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()

      if (sub) {
        // 1. 從瀏覽器移除
        await sub.unsubscribe()

        // 2. 從伺服器移除（Neon DB）
        await fetch("/api/push-subscribe", {
          method:  "DELETE",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ endpoint: sub.endpoint }),
        })
      }

      setIsSubscribed(false)
      console.log("[Push] 已取消訂閱")

    } catch (err: any) {
      setError(err.message ?? String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { isSupported, permission, isSubscribed, isLoading, error, subscribe, unsubscribe }
}
