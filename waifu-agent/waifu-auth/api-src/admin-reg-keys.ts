import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './_lib/db.js';
import { authenticate } from './_lib/auth.js';

function isAdmin(headers: Record<string, string | undefined>) {
  const auth = authenticate(headers);
  if (!auth || (auth.user.role !== 'admin' && auth.user.role !== 'superadmin')) return null;
  return auth;
}

function genKey(prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${rand(4)}-${rand(4)}`;
}

const TIER_PREFIX: Record<string, string> = {
  trial: 'WA-TRY',
  pro: 'WA-PRO',
  dev: 'WA-DEV',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const admin = isAdmin(req.headers as Record<string, string | undefined>);
  if (!admin) return res.status(401).json({ code: 1, message: '未授权' });

  if (req.method === 'POST') {
    const body = req.body || {};
    const tier = ['trial', 'pro', 'dev'].includes(body.tier) ? body.tier : 'trial';
    const count = Math.min(body.count || 1, 50);
    const expiresDays = body.expires_days || 30;
    const note = (body.note || '').substring(0, 255);
    const prefix = TIER_PREFIX[tier];
    const deviceLimit = 1; // 统一 1 台（暂无移动端）
    const expiresAt = new Date(Date.now() + expiresDays * 86400_000).toISOString();

    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      const key = genKey(prefix);
      await sql`
        INSERT INTO reg_keys (key, tier, device_limit, expires_at, created_by, note)
        VALUES (${key}, ${tier}, ${deviceLimit}, ${expiresAt}, ${admin.user.user_id}, ${note})
      `;
      keys.push(key);
    }

    return res.status(200).json({ code: 0, data: { keys, count, tier, expires_at: expiresAt } });
  }

  if (req.method === 'GET') {
    const qs = req.query;
    const page = Math.max(1, parseInt((qs.page as string) || '1'));
    const limit = Math.min(200, Math.max(1, parseInt((qs.limit as string) || '50')));
    const offset = (page - 1) * limit;
    const statusFilter = qs.status ? parseInt(qs.status as string) : 0;
    const tierFilter = (qs.tier as string) || '';
    const search = ((qs.search as string) || '').trim();

    // 统计概览（不受筛选影响）
    const [statsRow] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 1 AND expires_at >= NOW())::int AS unused,
        COUNT(*) FILTER (WHERE status = 2)::int AS used
      FROM reg_keys
    `;
    const unused = statsRow?.unused || 0;
    const used = statsRow?.used || 0;

    // 动态 WHERE
    const conditions: string[] = [];
    const params: any[] = [];
    if (statusFilter === 1) {
      conditions.push(`status = 1 AND expires_at >= NOW()`);
    } else if (statusFilter === 2) {
      conditions.push(`status = 2`);
    } else if (statusFilter === 3) {
      conditions.push(`(status = 3 OR (status = 1 AND expires_at < NOW()))`);
    }
    if (tierFilter && ['trial', 'pro', 'dev'].includes(tierFilter)) {
      conditions.push(`tier = $${params.length + 1}`);
      params.push(tierFilter);
    }
    if (search) {
      conditions.push(`(key ILIKE $${params.length + 1} OR note ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询总数
    const countSql = `SELECT COUNT(*)::int AS c FROM reg_keys ${where}`;
    const countResult = await sql.query(countSql, params);
    const total = countResult[0]?.c || 0;

    // 查询数据
    const dataSql = `SELECT id, key, tier, status, used_by, used_at, expires_at, created_at, note FROM reg_keys ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const keys = await sql.query(dataSql, [...params, limit, offset]);

    return res.status(200).json({ code: 0, data: { unused, used, total, page, limit, recent: keys } });
  }

  if (req.method === 'DELETE') {
    const body = req.body || {};
    const keyId = body.id;
    if (!keyId) return res.status(400).json({ code: 1, message: '缺少激活码 ID' });
    await sql`DELETE FROM reg_keys WHERE id = ${keyId}`;
    return res.status(200).json({ code: 0, message: '已删除' });
  }

  return res.status(405).json({ code: 1, message: 'Method Not Allowed' });
}
