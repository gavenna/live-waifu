import type { Handler } from '@netlify/functions';
import { sql } from '../../lib/db.js';
import { authenticate } from '../../lib/auth.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const auth = authenticate(event.headers);
  if (!auth) return { statusCode: 401, body: JSON.stringify({ code: 1, message: '请先登录' }) };
  let body: any;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ code: 1, message: '无效的请求格式' }) };
  }
  const { machine_code, device_name } = body;
  if (!machine_code) return { statusCode: 400, body: JSON.stringify({ code: 1, message: '无法获取设备信息' }) };
  const [user] = await sql`SELECT id, device_limit, status FROM users WHERE id = ${auth.user.user_id} LIMIT 1`;
  if (!user || user.status === 2) return { statusCode: 403, body: JSON.stringify({ code: 3, message: '账号异常' }) };
  const limit = Number(user.device_limit || 2);
  const existing = await sql`SELECT id, machine_code FROM devices WHERE user_id = ${auth.user.user_id}`;
  const thisMachine = existing.find((d: any) => d.machine_code === machine_code);
  const others = existing.filter((d: any) => d.machine_code !== machine_code);
  if (!thisMachine && others.length >= limit) {
    return { statusCode: 400, body: JSON.stringify({ code: 2, message: `设备数已达上限 (${limit})` }) };
  }
  await sql`INSERT INTO devices (user_id, machine_code, device_name, last_seen) VALUES (${auth.user.user_id}, ${machine_code}, ${device_name || ''}, NOW()) ON CONFLICT (machine_code) DO UPDATE SET last_seen = NOW()`;
  return { statusCode: 200, body: JSON.stringify({ code: 0, data: { bound: true, total: others.length + 1, limit } }) };
};
