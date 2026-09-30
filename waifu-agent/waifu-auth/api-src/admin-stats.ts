import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './_lib/db.js';
import { authenticate } from './_lib/auth.js';

function requireAdmin(headers: Record<string, string | undefined>) {
  const auth = authenticate(headers);
  if (!auth || (auth.user.role !== 'admin' && auth.user.role !== 'superadmin')) return null;
  return auth;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ code: 1, message: 'Method Not Allowed' });

  const admin = requireAdmin(req.headers as Record<string, string | undefined>);
  if (!admin) return res.status(401).json({ code: 1, message: '未授权' });

  const [users] = await sql`SELECT COUNT(*)::int AS c FROM users`;
  const [banned] = await sql`SELECT COUNT(*)::int AS c FROM users WHERE status = 2`;
  const [devices] = await sql`SELECT COUNT(*)::int AS c FROM devices`;
  const [sessions] = await sql`SELECT COUNT(*)::int AS c FROM refresh_tokens WHERE revoked = false AND expires_at > NOW()`;

  return res.status(200).json({
    code: 0,
    data: {
      total_users: users?.c || 0,
      banned_users: banned?.c || 0,
      total_devices: devices?.c || 0,
      active_sessions: sessions?.c || 0,
    },
  });
}
