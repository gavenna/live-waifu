import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './_lib/db.js';
import { decodeAccessToken } from './_lib/jwt.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ code: 1, message: 'Method Not Allowed' });

  const auth = req.headers['authorization'] || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ code: 1, message: '未提供 token' });

  // Gitee 不通时的兜底校验：不检查 JWT 过期，只验证签名+设备绑定+用户状态
  const payload = decodeAccessToken(match[1]);
  if (!payload) return res.status(401).json({ code: 2, message: 'token 无效' });

  const [user] = await sql`SELECT id, display_id, tier, device_limit, status FROM users WHERE id = ${payload.user_id} LIMIT 1`;
  if (!user) return res.status(404).json({ code: 3, message: '用户不存在' });
  if (user.status === 2) return res.status(403).json({ code: 4, message: `账号已被封禁（用户 ID: ${user.display_id || '#' + user.id}），请联系管理员` });

  // 检查设备是否仍绑定（解绑后即时踢出）
  const mc = (req.query.machine_code as string) || '';
  if (mc) {
    const [dev] = await sql`SELECT id FROM devices WHERE user_id = ${payload.user_id} AND machine_code = ${mc} LIMIT 1`;
    if (!dev) return res.status(403).json({ code: 5, message: '设备已被解绑，请重新激活' });
  }

  return res.status(200).json({
    code: 0,
    data: {
      user_id: Number(user.id),
      display_id: user.display_id,
      tier: user.tier,
      device_limit: Number(user.device_limit),
      status: user.status,
    },
  });
}
