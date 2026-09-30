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

// api-src/admin-users.ts
function requireAdmin(headers) {
  const auth = authenticate(headers);
  if (!auth || auth.user.role !== "admin" && auth.user.role !== "superadmin") return null;
  return auth;
}
var ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genDisplayId() {
  return "U-" + Array.from({ length: 6 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join("");
}
async function ensureDisplayId(user) {
  if (user.display_id) return user.display_id;
  for (let i = 0; i < 10; i++) {
    const did = genDisplayId();
    try {
      await sql`UPDATE users SET display_id = ${did} WHERE id = ${user.id} AND display_id IS NULL`;
      user.display_id = did;
      return did;
    } catch {
    }
  }
  return String(user.id);
}
function parseUrl(url) {
  const path = (url || "").split("?")[0];
  const parts = path.split("/");
  const idx = parts.findIndex((p) => p === "admin-users");
  const userId = idx >= 0 ? parseInt(parts[idx + 1] || "") : 0;
  const last = parts[parts.length - 1];
  const action = isNaN(parseInt(last)) ? last : "";
  return { userId, action };
}
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  const admin = requireAdmin(req.headers);
  if (!admin) return res.status(401).json({ code: 1, message: "\u672A\u6388\u6743" });
  const { userId, action } = parseUrl(req.url);
  if (req.method === "GET" && userId) {
    const [user] = await sql`SELECT id, display_id, tier, device_limit, status, created_at, updated_at FROM users WHERE id = ${userId} LIMIT 1`;
    if (!user) return res.status(404).json({ code: 2, message: "\u7528\u6237\u4E0D\u5B58\u5728" });
    await ensureDisplayId(user);
    const devices = await sql`SELECT id, machine_code, device_name, last_seen, created_at FROM devices WHERE user_id = ${userId} ORDER BY last_seen DESC`;
    const [keyInfo] = await sql`SELECT key, tier, used_at FROM reg_keys WHERE used_by = ${userId} ORDER BY used_at DESC LIMIT 1`;
    return res.status(200).json({ code: 0, data: { ...user, activation_key: keyInfo?.key || "-", devices } });
  }
  if (req.method === "GET") {
    const page = parseInt(req.query.page || "1");
    const limit = parseInt(req.query.limit || "20");
    const search = (req.query.search || "").trim();
    const offset = (page - 1) * limit;
    let userRows;
    let total;
    if (search) {
      const idSearch = parseInt(search);
      let matchedIds = [];
      if (!isNaN(idSearch)) {
        const found = await sql`SELECT id FROM users WHERE id = ${idSearch} LIMIT 1`;
        if (found.length > 0) matchedIds.push(Number(found[0].id));
      }
      const displayMatches = await sql`SELECT id FROM users WHERE display_id = ${search} LIMIT 1`;
      for (const u of displayMatches) {
        const uid = Number(u.id);
        if (!matchedIds.includes(uid)) matchedIds.push(uid);
      }
      const deviceMatches = await sql`SELECT user_id FROM devices WHERE machine_code ILIKE ${"%" + search + "%"} LIMIT 20`;
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
    const users = await Promise.all(userRows.map(async (u) => ({
      id: Number(u.id),
      display_id: await ensureDisplayId(u),
      tier: u.tier,
      device_limit: Number(u.device_limit),
      status: u.status,
      created_at: u.created_at,
      activation_key: u.activation_key || null
    })));
    return res.status(200).json({ code: 0, data: { users, total, page, limit, search: search || void 0 } });
  }
  if (req.method === "POST" && userId && action === "ban") {
    const body = req.body || {};
    const target = body.ban === false ? 1 : 2;
    await sql`UPDATE users SET status = ${target} WHERE id = ${userId}`;
    if (target === 2) await sql`UPDATE refresh_tokens SET revoked = true WHERE user_id = ${userId}`;
    return res.status(200).json({ code: 0, message: target === 2 ? "\u5DF2\u5C01\u7981" : "\u5DF2\u89E3\u5C01" });
  }
  if (req.method === "POST" && userId && action === "unbind-all") {
    await sql`UPDATE reg_keys SET status = 1, used_by = NULL, used_at = NULL WHERE used_by = ${userId}`;
    await sql`DELETE FROM devices WHERE user_id = ${userId}`;
    await sql`DELETE FROM refresh_tokens WHERE user_id = ${userId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    return res.status(200).json({ code: 0, message: "\u5DF2\u89E3\u7ED1\u6240\u6709\u8BBE\u5907\uFF0C\u6FC0\u6D3B\u7801\u5DF2\u6062\u590D\u53EF\u7528" });
  }
  if (req.method === "DELETE" && userId) {
    await sql`DELETE FROM refresh_tokens WHERE user_id = ${userId}`;
    await sql`DELETE FROM devices WHERE user_id = ${userId}`;
    await sql`UPDATE reg_keys SET used_by = NULL WHERE used_by = ${userId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    return res.status(200).json({ code: 0, message: "\u5DF2\u5220\u9664\u7528\u6237" });
  }
  if (req.method === "PUT" && userId) {
    const body = req.body || {};
    if (body.tier) await sql`UPDATE users SET tier = ${body.tier} WHERE id = ${userId}`;
    if (body.device_limit) await sql`UPDATE users SET device_limit = ${body.device_limit} WHERE id = ${userId}`;
    return res.status(200).json({ code: 0, message: "\u5DF2\u66F4\u65B0" });
  }
  return res.status(405).json({ code: 1, message: "Method Not Allowed" });
}
export {
  handler as default
};
