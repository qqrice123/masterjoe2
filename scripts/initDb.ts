import { neon } from "@neondatabase/serverless";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("Please set DATABASE_URL in .env file");
  process.exit(1);
}

const sql = neon(dbUrl);

async function initDb() {
  try {
    console.log("Reading schema.sql...");
    const schemaPath = path.join(process.cwd(), "db", "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf-8");

    console.log("Connecting to Neon database and executing schema...");
    
    // 將 SQL 切割成多個語句執行，因為 neon 的 query builder 可能不支援一次執行多個獨立的語句
    // 並且過濾掉註解，否則可能會造成語法錯誤
    const statements = schemaSql
      .split(';')
      .map(stmt => {
        return stmt.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim();
      })
      .filter(stmt => stmt.length > 0);

    for (const stmt of statements) {
       console.log(`Executing: ${stmt.substring(0, 50)}...`);
       await sql(stmt);
    }

    console.log("✅ Database initialized successfully!");
    
    // 驗證一下寫入結果
    const rows = await sql`SELECT * FROM ai_weights`;
    console.log(`Current rows in ai_weights: ${rows.length}`);
    
  } catch (error) {
    console.error("❌ Failed to initialize database:", error);
  }
}

initDb();