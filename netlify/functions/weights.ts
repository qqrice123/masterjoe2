import { Handler } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const handler: Handler = async (event, context) => {
  // 處理 CORS Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "OK" };
  }

  // 檢查是否設定了 Neon 的連接字串
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    // 故意回傳 404 讓前端退回 LocalStorage，避免沒有設定資料庫時整個系統崩潰
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "DATABASE_URL is not set" }),
    };
  }

  const sql = neon(dbUrl);

  try {
    // GET: 取得所有最新的權重
    if (event.httpMethod === "GET") {
      const rows = await sql`SELECT * FROM ai_weights`;
      
      // 轉換成前端 AIWeights 需要的格式
      const weightsRecord: Record<string, any> = {};
      const learnCountRecord: Record<string, number> = {};

      rows.forEach((row) => {
        weightsRecord[row.race_type] = {
          baseProbWeight: row.base_prob_weight,
          evWeight: row.ev_weight,
          ratioWeight: row.ratio_weight,
          largeBetWeight: row.large_bet_weight,
        };
        learnCountRecord[row.race_type] = row.learn_count;
      });

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ weights: weightsRecord, learnCount: learnCountRecord }),
      };
    }

    // POST: 更新權重 (從前端回傳)
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { raceType, weights, learnCount } = body;

      if (!raceType || !weights) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid payload" }) };
      }

      await sql`
        INSERT INTO ai_weights (race_type, base_prob_weight, ev_weight, ratio_weight, large_bet_weight, learn_count, updated_at)
        VALUES (
          ${raceType}, 
          ${weights.baseProbWeight}, 
          ${weights.evWeight}, 
          ${weights.ratioWeight}, 
          ${weights.largeBetWeight}, 
          ${learnCount ?? 0},
          NOW()
        )
        ON CONFLICT (race_type) DO UPDATE SET
          base_prob_weight = EXCLUDED.base_prob_weight,
          ev_weight = EXCLUDED.ev_weight,
          ratio_weight = EXCLUDED.ratio_weight,
          large_bet_weight = EXCLUDED.large_bet_weight,
          learn_count = EXCLUDED.learn_count,
          updated_at = NOW()
      `;

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true }),
      };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };

  } catch (error: any) {
    console.error("[Neon DB Error]:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message }),
    };
  }
};