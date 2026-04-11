import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function checkSchema() {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'odds_snapshots';
    `;
    console.log('Columns in odds_snapshots:', result);
  } catch (error) {
    console.error('❌ Connection failed:', error);
  }
}

checkSchema();
