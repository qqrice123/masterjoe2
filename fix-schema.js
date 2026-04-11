import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function fixSchema() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    await sql`ALTER TABLE odds_snapshots ADD COLUMN IF NOT EXISTS horse_name varchar(255);`;
    await sql`ALTER TABLE odds_snapshots ADD COLUMN IF NOT EXISTS mtp_bucket integer;`;
    
    try {
      await sql`ALTER TABLE odds_snapshots ADD CONSTRAINT odds_snapshots_unique_bucket UNIQUE (date, venue, race_no, runner_number, mtp_bucket);`;
      console.log('✅ Added unique constraint');
    } catch (e) {
      console.log('Constraint error:', e.message);
    }
    
    console.log('✅ Schema updated successfully');
  } catch (error) {
    console.error('❌ Update failed:', error);
  }
}

fixSchema();
