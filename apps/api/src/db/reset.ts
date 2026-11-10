import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await pool.end();
  console.log('Database emptied');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
