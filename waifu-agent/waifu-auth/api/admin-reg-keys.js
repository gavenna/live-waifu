// api-src/_lib/db.ts
import { neon } from "@neondatabase/serverless";
var DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.warn("[db] DATABASE_URL not set \u2014 DB calls will fail");
}
var sql = neon(DATABASE_URL);

// api-src/_lib/jwt.ts
import jwt from "jsonwebtoken";
var JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
var REFRESH_EXPIRES_SEC = 30 * 24 * 3600;
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// api-src/_lib/auth.ts
function authenticate(headers) {
  const auth = headers["authorization"] || headers["Authorization"] || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = verifyAccessToken(match[1]);
  if (!payload) return null;
  return { user: payload };
}

// api-src/admin-reg-keys.ts
function isAdmin(headers) {
  const auth = authenticate(headers);
  if (!auth || auth.user.role !== "admin" && auth.user.role !== "superadmin") return null;
  return auth;
}
function genKey(prefix) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${prefix}-${rand(4)}-${rand(4)}`;
}
var TIER_PREFIX = {
  trial: "WA-TRY",
  pro: "WA-PRO",
  dev: "WA-DEV"
};
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  const admin = isAdmin(req.headers);
  if (!admin) return res.status(401).json({ code: 1, message: "\u672A\u6388\u6743" });
  if (req.method === "POST") {
    const body = req.body || {};
    const tier = ["trial", "pro", "dev"].includes(body.tier) ? body.tier : "trial";
    const count = Math.min(body.count || 1, 50);
    const expiresDays = body.expires_days || 30;
    const note = (body.note || "").substring(0, 255);
    const prefix = TIER_PREFIX[tier];
    const deviceLimit = 1;
    const expiresAt = new Date(Date.now() + expiresDays * 864e5).toISOString();
    const keys = [];
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
  if (req.method === "GET") {
    const qs = req.query;
    const page = Math.max(1, parseInt(qs.page || "1"));
    const limit = Math.min(200, Math.max(1, parseInt(qs.limit || "50")));
    const offset = (page - 1) * limit;
    const statusFilter = qs.status ? parseInt(qs.status) : 0;
    const tierFilter = qs.tier || "";
    const search = (qs.search || "").trim();
    const [statsRow] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 1 AND expires_at >= NOW())::int AS unused,
        COUNT(*) FILTER (WHERE status = 2)::int AS used
      FROM reg_keys
    `;
    const unused = statsRow?.unused || 0;
    const used = statsRow?.used || 0;
    const conditions = [];
    const params = [];
    if (statusFilter === 1) {
      conditions.push(`status = 1 AND expires_at >= NOW()`);
    } else if (statusFilter === 2) {
      conditions.push(`status = 2`);
    } else if (statusFilter === 3) {
      conditions.push(`(status = 3 OR (status = 1 AND expires_at < NOW()))`);
    }
    if (tierFilter && ["trial", "pro", "dev"].includes(tierFilter)) {
      conditions.push(`tier = $${params.length + 1}`);
      params.push(tierFilter);
    }
    if (search) {
      conditions.push(`(key ILIKE $${params.length + 1} OR note ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*)::int AS c FROM reg_keys ${where}`;
    const countResult = await sql.query(countSql, params);
    const total = countResult[0]?.c || 0;
    const dataSql = `SELECT id, key, tier, status, used_by, used_at, expires_at, created_at, note FROM reg_keys ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const keys = await sql.query(dataSql, [...params, limit, offset]);
    return res.status(200).json({ code: 0, data: { unused, used, total, page, limit, recent: keys } });
  }
  if (req.method === "DELETE") {
    const body = req.body || {};
    const keyId = body.id;
    if (!keyId) return res.status(400).json({ code: 1, message: "\u7F3A\u5C11\u6FC0\u6D3B\u7801 ID" });
    await sql`DELETE FROM reg_keys WHERE id = ${keyId}`;
    return res.status(200).json({ code: 0, message: "\u5DF2\u5220\u9664" });
  }
  return res.status(405).json({ code: 1, message: "Method Not Allowed" });
}
export {
  handler as default
};
