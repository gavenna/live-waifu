import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './_lib/db.js';
import { authenticate } from './_lib/auth.js';

function requireAdmin(headers: Record<string, string | undefined>) {
  const auth = authenticate(headers);
  if (!auth || (auth.user.role !== 'admin' && auth.user.role !== 'superadmin')) return null;
  return auth;
}

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genDisplayId(): string {
  return 'U-' + Array.from({ length: 6 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');
}

// 确保用户有 display_id，没有则生成并写入 DB
async function ensureDisplayId(user: any): Promise<string> {
  if (user.display_id) return user.display_id;
  for (let i = 0; i < 10; i++) {
    const did = genDisplayId();
    try {
      await sql`UPDATE users SET display_id = ${did} WHERE id = ${user.id} AND display_id IS NULL`;
      user.display_id = did;
      return did;
    } catch { /* unique violation, retry */ }
  }
  return String(user.id);
}

// 从 URL 解析 /api/admin-users/:id/:action
function parseUrl(url: string | undefined): { userId: number; action: string } {
  const path = (url || '').split('?')[0];
  const parts = path.split('/');
  const idx = parts.findIndex(p => p === 'admin-users');
  const userId = idx >= 0 ? parseInt(parts[idx + 1] || '') : 0;
  const last = parts[parts.length - 1];
  const action = isNaN(parseInt(last)) ? last : '';
  return { userId, action };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const admin = requireAdmin(req.headers as Record<string, string | undefined>);
  if (!admin) return res.status(401).json({ code: 1, message: '未授权' });

  const { userId, action } = parseUrl(req.url);

  // GET /api/admin-users/:id — 单用户详情
  if (req.method === 'GET' && userId) {
    const [user] = await sql`SELECT id, display_id, tier, device_limit, status, created_at, updated_at FROM users WHERE id = ${userId} LIMIT 1`;
    if (!user) return res.status(404).json({ code: 2, message: '用户不存在' });
    await ensureDisplayId(user);
    const devices = await sql`SELECT id, machine_code, device_name, last_seen, created_at FROM devices WHERE user_id = ${userId} ORDER BY last_seen DESC`;
    const [keyInfo] = await sql`SELECT key, tier, used_at FROM reg_keys WHERE used_by = ${userId} ORDER BY used_at DESC LIMIT 1`;
    return res.status(200).json({ code: 0, data: { ...user, activation_key: keyInfo?.key || '-', devices } });
  }

  // GET /api/admin-users — 用户列表
  if (req.method === 'GET') {
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '20');
    const search = ((req.query.search as string) || '').trim();
    const offset = (page - 1) * limit;

    let userRows: any[];
    let total: number;

    if (search) {
      const idSearch = parseInt(search);
      let matchedIds: number[] = [];
      if (!isNaN(idSearch)) {
        const found = await sql`SELECT id FROM users WHERE id = ${idSearch} LIMIT 1`;
        if (found.length > 0) matchedIds.push(Number(found[0].id));
      }
      const displayMatches = await sql`SELECT id FROM users WHERE display_id = ${search} LIMIT 1`;
      for (const u of displayMatches) {
        const uid = Number(u.id);
        if (!matchedIds.includes(uid)) matchedIds.push(uid);
      }
      const deviceMatches = await sql`SELECT user_id FROM devices WHERE machine_code ILIKE ${'%' + search + '%'} LIMIT 20`;
      for (const d of deviceMatches) {
        const uid = Number(d.user_id);
        if (!matchedIds.includes(uid)) matchedIds.push(uid);
      }
      if (matchedIds.length === 0) {
        return res.status(200).json({ code: 0, data: { users: [], total: 0, page, limit, search } });
      }
      userRows = await sql`
        SELECT u.id, u.tier, u.device_limit, u.status, u.created_at, u.display_id, r.key as activation_key
        FROM users u
        LEFT JOIN reg_keys r ON r.used_by = u.id
        WHERE u.id = ANY(${matchedIds})
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      total = matchedIds.length;
    } else {
      const [c] = await sql`SELECT COUNT(*)::int as c FROM users`;
      total = c?.c || 0;
      userRows = await sql`
        SELECT u.id, u.tier, u.device_limit, u.status, u.created_at, u.display_id, r.key as activation_key
        FROM users u
        LEFT JOIN reg_keys r ON r.used_by = u.id
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const users = await Promise.all(userRows.map(async (u: any) => ({
      id: Number(u.id),
      display_id: await ensureDisplayId(u),
      tier: u.tier,
      device_limit: Number(u.device_limit),
      status: u.status,
      created_at: u.created_at,
      activation_key: u.activation_key || null,
    })));

    return res.status(200).json({ code: 0, data: { users, total, page, limit, search: search || undefined } });
  }

  // POST /api/admin-users/:id/ban — 封禁/解封
  if (req.method === 'POST' && userId && action === 'ban') {
    const body = req.body || {};
    const target = body.ban === false ? 1 : 2;
    await sql`UPDATE users SET status = ${target} WHERE id = ${userId}`;
    if (target === 2) await sql`UPDATE refresh_tokens SET revoked = true WHERE user_id = ${userId}`;
    return res.status(200).json({ code: 0, message: target === 2 ? '已封禁' : '已解封' });
  }

  // POST /api/admin-users/:id/unbind-all — 解绑所有设备
  if (req.method === 'POST' && userId && action === 'unbind-all') {
    // 恢复激活码
    await sql`UPDATE reg_keys SET status = 1, used_by = NULL, used_at = NULL WHERE used_by = ${userId}`;
    // 清理关联数据
    await sql`DELETE FROM devices WHERE user_id = ${userId}`;
    await sql`DELETE FROM refresh_tokens WHERE user_id = ${userId}`;
    // 删除用户
    await sql`DELETE FROM users WHERE id = ${userId}`;
    return res.status(200).json({ code: 0, message: '已解绑所有设备，激活码已恢复可用' });
  }

  // DELETE /api/admin-users/:id — 删除用户
  if (req.method === 'DELETE' && userId) {
    await sql`DELETE FROM refresh_tokens WHERE user_id = ${userId}`;
    await sql`DELETE FROM devices WHERE user_id = ${userId}`;
    await sql`UPDATE reg_keys SET used_by = NULL WHERE used_by = ${userId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    return res.status(200).json({ code: 0, message: '已删除用户' });
  }

  // PUT /api/admin-users/:id — 更新用户
  if (req.method === 'PUT' && userId) {
    const body = req.body || {};
    if (body.tier) await sql`UPDATE users SET tier = ${body.tier} WHERE id = ${userId}`;
    if (body.device_limit) await sql`UPDATE users SET device_limit = ${body.device_limit} WHERE id = ${userId}`;
    return res.status(200).json({ code: 0, message: '已更新' });
  }

  return res.status(405).json({ code: 1, message: 'Method Not Allowed' });
}
