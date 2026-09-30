import type { Handler } from '@netlify/functions';
import crypto from 'crypto';
import { sql } from '../../lib/db.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const auth = event.headers['authorization'] || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { statusCode: 401, body: JSON.stringify({ code: 1, message: '未提供 token' }) };
  const hash = crypto.createHash('sha256').update(match[1]).digest('hex');
  await sql`UPDATE refresh_tokens SET revoked = true WHERE token_hash = ${hash}`;
  return { statusCode: 200, body: JSON.stringify({ code: 0, message: '已登出' }) };
};
