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

// api-src/admin-stats.ts
function requireAdmin(headers) {
  const auth = authenticate(headers);
  if (!auth || auth.user.role !== "admin" && auth.user.role !== "superadmin") return null;
  return auth;
}
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ code: 1, message: "Method Not Allowed" });
  const admin = requireAdmin(req.headers);
  if (!admin) return res.status(401).json({ code: 1, message: "\u672A\u6388\u6743" });
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
      active_sessions: sessions?.c || 0
    }
  });
}
export {
  handler as default
};
