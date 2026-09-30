import type { Handler } from '@netlify/functions';
import { sql } from '../../lib/db.js';
import { authenticate } from '../../lib/auth.js';

export const handler: Handler = async (event) => {
  const auth = authenticate(event.headers);
  if (!auth) return { statusCode: 401, body: JSON.stringify({ code: 1, message: '请先登录' }) };
  const [user] = await sql`SELECT status FROM users WHERE id = ${auth.user.user_id} LIMIT 1`;
  if (!user || user.status === 2) return { statusCode: 403, body: JSON.stringify({ code: 3, message: '账号已被封禁' }) };
  const machine_code = event.queryStringParameters?.machine_code || '';
  let bound = false;
  if (machine_code) {
    const [dev] = await sql`SELECT id FROM devices WHERE user_id = ${auth.user.user_id} AND machine_code = ${machine_code} LIMIT 1`;
    bound = !!dev;
  }
  return { statusCode: 200, body: JSON.stringify({ code: 0, data: { user_id: Number(auth.user.user_id), tier: auth.user.tier, device_bound: bound } }) };
};
