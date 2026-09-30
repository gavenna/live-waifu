import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.warn('[db] DATABASE_URL not set — DB calls will fail');
}

export const sql = neon(DATABASE_URL);
