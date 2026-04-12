// netlify/functions/api/push-subscribe.ts
import { neon } from "@neondatabase/serverless"

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  }
}

export async function POST(event: any) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: "DATABASE_URL not configured" })
  }

  try {
    const subscription = JSON.parse(event.body || "{}")
    
    if (!subscription.endpoint) {
      return json(400, { error: "Invalid subscription: missing endpoint" })
    }

    const sql = neon(process.env.DATABASE_URL)
    
    // Upsert subscription into database
    await sql`
      INSERT INTO push_subscriptions (endpoint, auth, p256dh, created_at)
      VALUES (
        ${subscription.endpoint}, 
        ${subscription.keys?.auth || null}, 
        ${subscription.keys?.p256dh || null}, 
        NOW()
      )
      ON CONFLICT (endpoint) 
      DO UPDATE SET 
        auth = EXCLUDED.auth,
        p256dh = EXCLUDED.p256dh,
        updated_at = NOW()
    `

    return json(201, { success: true })
  } catch (error: any) {
    console.error("Failed to save push subscription:", error)
    return json(500, { error: "Failed to save subscription", detail: error.message })
  }
}

export async function DELETE(event: any) {
  if (!process.env.DATABASE_URL) {
    return json(500, { error: "DATABASE_URL not configured" })
  }

  try {
    const { endpoint } = JSON.parse(event.body || "{}")
    
    if (!endpoint) {
      return json(400, { error: "Missing endpoint" })
    }

    const sql = neon(process.env.DATABASE_URL)
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`

    return json(200, { success: true })
  } catch (error: any) {
    console.error("Failed to delete push subscription:", error)
    return json(500, { error: "Failed to delete subscription", detail: error.message })
  }
}