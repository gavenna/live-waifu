import type { Handler } from '@netlify/functions';
import { sql } from '../../lib/db.js';
import { authenticate } from '../../lib/auth.js';

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

export const handler: Handler = async (event) => {
  const admin = requireAdmin(event.headers);
  if (!admin) return { statusCode: 401, body: JSON.stringify({ code: 1, message: '未授权' }) };
  const parts = event.rawUrl.split('/');
  const usersIdx = parts.findIndex((p: string) => p === 'admin-users');
  const userId = usersIdx >= 0 ? parseInt(parts[usersIdx + 1] || '') : 0;
  const action = isNaN(parseInt(parts[parts.length - 1])) ? parts[parts.length - 1] : '';

  if (event.httpMethod === 'GET' && userId) {
    const [user] = await sql`SELECT id, display_id, tier, device_limit, status, created_at, updated_at FROM users WHERE id = ${userId} LIMIT 1`;
    if (!user) return { statusCode: 404, body: JSON.stringify({ code: 2, message: '用户不存在' }) };
    await ensureDisplayId(user);
    const devices = await sql`SELECT id, machine_code, device_name, last_seen, created_at FROM devices WHERE user_id = ${userId} ORDER BY last_seen DESC`;
    const [keyInfo] = await sql`SELECT key, tier, used_at FROM reg_keys WHERE used_by = ${userId} ORDER BY used_at DESC LIMIT 1`;
    return { statusCode: 200, body: JSON.stringify({ code: 0, data: { ...user, activation_key: keyInfo?.key || '-', devices } }) };
  }

  if (event.httpMethod === 'GET') {
    const page = parseInt(event.queryStringParameters?.page || '1');
    const limit = parseInt(event.queryStringParameters?.limit || '20');
    const search = (event.queryStringParameters?.search || '').trim();
    const offset = (page - 1) * limit;

    let userRows: any[];
    let total: number;

    if (search) {
      // Search by user ID (exact), display_id (exact), or machine_code (partial)
      const idSearch = parseInt(search);
      let matchedIds: number[] = [];
      if (!isNaN(idSearch)) {
        const found = await sql`SELECT id FROM users WHERE id = ${idSearch} LIMIT 1`;
        if (found.length > 0) matchedIds.push(Number(found[0].id));
      }
      // Search by display_id
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
        return { statusCode: 200, body: JSON.stringify({ code: 0, data: { users: [], total: 0, page, limit, search } }) };
      }
      // Fetch users with matching IDs + LEFT JOIN reg_keys for activation key
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

    return { statusCode: 200, body: JSON.stringify({ code: 0, data: { users, total, page, limit, search: search || undefined } }) };
  }

  if (event.httpMethod === 'POST' && userId) {
    if (action === 'ban') {
      let body: any = {};
      try { body = JSON.parse(event.body || '{}'); } catch { /* */ }
      const target = body.ban === false ? 1 : 2;
      await sql`UPDATE users SET status = ${target} WHERE id = ${userId}`;
      if (target === 2) await sql`UPDATE refresh_tokens SET revoked = true WHERE user_id = ${userId}`;
      return { statusCode: 200, body: JSON.stringify({ code: 0, message: target === 2 ? '已封禁' : '已解封' }) };
    }
    if (action === 'unbind-all') {
      await sql`DELETE FROM devices WHERE user_id = ${userId}`;
      return { statusCode: 200, body: JSON.stringify({ code: 0, message: '已解绑所有设备' }) };
    }
  }

  if (event.httpMethod === 'DELETE' && userId) {
    // 清理关联数据（ON DELETE CASCADE 也会处理，但显式清理更安全）
    await sql`DELETE FROM refresh_tokens WHERE user_id = ${userId}`;
    await sql`DELETE FROM devices WHERE user_id = ${userId}`;
    await sql`UPDATE reg_keys SET used_by = NULL WHERE used_by = ${userId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    return { statusCode: 200, body: JSON.stringify({ code: 0, message: '已删除用户' }) };
  }

  if (event.httpMethod === 'PUT' && userId) {
    let body: any = {};
    try { body = JSON.parse(event.body || '{}'); } catch { /* */ }
    if (body.tier) await sql`UPDATE users SET tier = ${body.tier} WHERE id = ${userId}`;
    if (body.device_limit) await sql`UPDATE users SET device_limit = ${body.device_limit} WHERE id = ${userId}`;
    return { statusCode: 200, body: JSON.stringify({ code: 0, message: '已更新' }) };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
