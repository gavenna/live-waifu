import type { Handler } from '@netlify/functions';
import { sql } from '../../lib/db.js';
import { authenticate } from '../../lib/auth.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'DELETE' && event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const auth = authenticate(event.headers);
  if (!auth) return { statusCode: 401, body: JSON.stringify({ code: 1, message: '请先登录' }) };
  let body: any;
  try { body = JSON.parse(event.body || '{}'); } catch { /* */ }
  const deviceId = parseInt(event.queryStringParameters?.id || body?.id || '0');
  if (!deviceId) return { statusCode: 400, body: JSON.stringify({ code: 1, message: '缺少设备 ID' }) };
  const [device] = await sql`SELECT id FROM devices WHERE id = ${deviceId} AND user_id = ${auth.user.user_id} LIMIT 1`;
  if (!device) return { statusCode: 404, body: JSON.stringify({ code: 2, message: '设备不存在或无权操作' }) };
  await sql`DELETE FROM devices WHERE id = ${deviceId}`;
  return { statusCode: 200, body: JSON.stringify({ code: 0, message: '已解绑' }) };
};
