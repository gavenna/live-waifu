import type { Handler } from '@netlify/functions';
import { sql } from '../../lib/db.js';
import { authenticate } from '../../lib/auth.js';

export const handler: Handler = async (event) => {
  const auth = authenticate(event.headers);
  if (!auth) return { statusCode: 401, body: JSON.stringify({ code: 1, message: '请先登录' }) };
  const devices = await sql`SELECT id, machine_code, device_name, last_seen, created_at FROM devices WHERE user_id = ${auth.user.user_id} ORDER BY last_seen DESC`;
  return { statusCode: 200, body: JSON.stringify({ code: 0, data: devices }) };
};
