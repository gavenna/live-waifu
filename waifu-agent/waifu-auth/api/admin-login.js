// api-src/admin-login.ts
import bcrypt from "bcryptjs";

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
var ACCESS_EXPIRES = "2h";
var REFRESH_EXPIRES_SEC = 30 * 24 * 3600;
function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

// api-src/_lib/limiter.ts
var hits = /* @__PURE__ */ new Map();
function rateLimit(key, max, windowSec) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowSec * 1e3 });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    if (now > v.resetAt) hits.delete(k);
  }
}, 10 * 60 * 1e3);

// api-src/admin-login.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ code: 1, message: "Method Not Allowed" });
  const ip = req.headers["x-forwarded-for"] || "unknown";
  if (!rateLimit(`login:${ip}`, 10, 3600)) {
    return res.status(429).json({ code: 1, message: "\u767B\u5F55\u5C1D\u8BD5\u8FC7\u591A\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" });
  }
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ code: 1, message: "\u7F3A\u5C11\u7528\u6237\u540D\u6216\u5BC6\u7801" });
  const [admin] = await sql`SELECT id, username, password, role FROM admins WHERE username = ${username} LIMIT 1`;
  if (!admin) return res.status(401).json({ code: 1, message: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF" });
  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) return res.status(401).json({ code: 1, message: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF" });
  const access_token = signAccessToken({ user_id: Number(admin.id), display_id: admin.username, tier: "admin", role: admin.role });
  return res.status(200).json({ code: 0, data: { access_token, expires_in: 7200, role: admin.role } });
}
export {
  handler as default
};
