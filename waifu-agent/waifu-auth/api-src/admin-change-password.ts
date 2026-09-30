import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { sql } from './_lib/db.js';
import { authenticate } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ code: 1, message: 'Method Not Allowed' });

  const auth = authenticate(req.headers as Record<string, string | undefined>);
  if (!auth || (auth.user.role !== 'admin' && auth.user.role !== 'superadmin')) {
    return res.status(401).json({ code: 1, message: '未授权' });
  }

  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ code: 1, message: '缺少旧密码或新密码' });
  if (new_password.length < 6) return res.status(400).json({ code: 1, message: '新密码至少6位' });

  const [admin] = await sql`SELECT id, password FROM admins WHERE id = ${auth.user.user_id} LIMIT 1`;
  if (!admin) return res.status(404).json({ code: 1, message: '管理员不存在' });

  const valid = await bcrypt.compare(old_password, admin.password);
  if (!valid) return res.status(401).json({ code: 1, message: '旧密码错误' });

  const hash = await bcrypt.hash(new_password, 10);
  await sql`UPDATE admins SET password = ${hash} WHERE id = ${admin.id}`;
  return res.status(200).json({ code: 0, message: '密码已修改' });
}
