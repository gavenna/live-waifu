import type { Handler } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { sql } from '../../lib/db.js';
import { signAccessToken } from '../../lib/jwt.js';
import { rateLimit } from '../../lib/limiter.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const ip = event.headers['x-forwarded-for'] || 'unknown';
  if (!rateLimit(`admin:${ip}`, 10, 3600)) return { statusCode: 429, body: JSON.stringify({ code: 429, message: '操作过于频繁' }) };
  let body: any;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: JSON.stringify({ code: 1, message: '无效的请求格式' }) }; }
  const { username, password } = body;
  if (!username || !password) return { statusCode: 400, body: JSON.stringify({ code: 1, message: '用户名和密码不能为空' }) };
  const [admin] = await sql`SELECT id, username, password, role FROM admins WHERE username = ${username} LIMIT 1`;
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return { statusCode: 401, body: JSON.stringify({ code: 2, message: '用户名或密码错误' }) };
  }
  const access_token = signAccessToken({ user_id: Number(admin.id), tier: 'admin', role: admin.role });
  return { statusCode: 200, body: JSON.stringify({ code: 0, data: { access_token, expires_in: 7200, role: admin.role } }) };
};
