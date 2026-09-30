import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './_lib/db.js';
import { authenticate } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = authenticate(req.headers as Record<string, string | undefined>);
  if (!auth) return res.status(401).json({ code: 1, message: '请先登录' });

  // ── bind (POST, body.machine_code) ──
  if (req.method === 'POST' && (req.body as any)?.machine_code) {
    const { machine_code, device_name } = req.body || {} as any;
    const [user] = await sql`SELECT id, device_limit, status FROM users WHERE id = ${auth.user.user_id} LIMIT 1`;
    if (!user || user.status === 2) return res.status(403).json({ code: 3, message: '账号异常' });

    const limit = Number(user.device_limit || 1);
    const existing = await sql`SELECT id, machine_code FROM devices WHERE user_id = ${auth.user.user_id}`;
    const thisMachine = existing.find((d: any) => d.machine_code === machine_code);
    const others = existing.filter((d: any) => d.machine_code !== machine_code);
    if (!thisMachine && others.length >= limit) {
      return res.status(400).json({ code: 2, message: `设备数已达上限 (${limit})` });
    }
    await sql`INSERT INTO devices (user_id, machine_code, device_name, last_seen) VALUES (${auth.user.user_id}, ${machine_code}, ${device_name || ''}, NOW()) ON CONFLICT (machine_code) DO UPDATE SET last_seen = NOW()`;
    return res.status(200).json({ code: 0, data: { bound: true, total: others.length + 1, limit } });
  }

  // ── delete (DELETE, or POST with id) ──
  if (req.method === 'DELETE' || (req.method === 'POST' && ((req.body as any)?.id || (req.query as any)?.id))) {
    const deviceId = parseInt((req.query as any)?.id || (req.body as any)?.id || '0');
    if (!deviceId) return res.status(400).json({ code: 1, message: '缺少设备 ID' });
    const [device] = await sql`SELECT id FROM devices WHERE id = ${deviceId} AND user_id = ${auth.user.user_id} LIMIT 1`;
    if (!device) return res.status(404).json({ code: 2, message: '设备不存在或无权操作' });
    await sql`DELETE FROM devices WHERE id = ${deviceId}`;
    return res.status(200).json({ code: 0, message: '已解绑' });
  }

  // ── GET → check (with machine_code) or list ──
  if (req.method === 'GET') {
    const machine_code = ((req.query as any)?.machine_code as string) || '';
    if (machine_code) {
      const [user] = await sql`SELECT status FROM users WHERE id = ${auth.user.user_id} LIMIT 1`;
      if (!user || user.status === 2) return res.status(403).json({ code: 3, message: '账号已被封禁' });
      const [dev] = await sql`SELECT id FROM devices WHERE user_id = ${auth.user.user_id} AND machine_code = ${machine_code} LIMIT 1`;
      return res.status(200).json({ code: 0, data: { user_id: Number(auth.user.user_id), tier: auth.user.tier, device_bound: !!dev } });
    }
    // list
    const devices = await sql`SELECT id, machine_code, device_name, last_seen, created_at FROM devices WHERE user_id = ${auth.user.user_id} ORDER BY last_seen DESC`;
    return res.status(200).json({ code: 0, data: devices });
  }

  return res.status(405).json({ code: 1, message: 'Method Not Allowed' });
}
