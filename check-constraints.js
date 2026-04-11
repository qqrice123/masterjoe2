import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function checkConstraints() {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'odds_snapshots';
    `;
    console.log('Constraints:', result);
  } catch (error) {
    console.error('❌ Connection failed:', error);
  }
}

checkConstraints();
