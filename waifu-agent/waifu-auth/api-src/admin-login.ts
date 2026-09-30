import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { sql } from './_lib/db.js';
import { signAccessToken } from './_lib/jwt.js';
import { rateLimit } from './_lib/limiter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ code: 1, message: 'Method Not Allowed' });

  const ip = (req.headers['x-forwarded-for'] as string) || 'unknown';
  if (!rateLimit(`login:${ip}`, 10, 3600)) {
    return res.status(429).json({ code: 1, message: '登录尝试过多，请稍后再试' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ code: 1, message: '缺少用户名或密码' });

  const [admin] = await sql`SELECT id, username, password, role FROM admins WHERE username = ${username} LIMIT 1`;
  if (!admin) return res.status(401).json({ code: 1, message: '用户名或密码错误' });

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) return res.status(401).json({ code: 1, message: '用户名或密码错误' });

  const access_token = signAccessToken({ user_id: Number(admin.id), display_id: admin.username, tier: 'admin', role: admin.role });
  return res.status(200).json({ code: 0, data: { access_token, expires_in: 7200, role: admin.role } });
}
