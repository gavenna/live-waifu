// api-src/auth-refresh.ts
import crypto2 from "crypto";

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
function generateRefreshToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
function refreshExpiresAt() {
  return new Date(Date.now() + REFRESH_EXPIRES_SEC * 1e3);
}

// api-src/auth-refresh.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ code: 1, message: "Method Not Allowed" });
  const auth = req.headers["authorization"] || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ code: 1, message: "\u672A\u63D0\u4F9B refresh_token" });
  const oldHash = crypto2.createHash("sha256").update(match[1]).digest("hex");
  const [stored] = await sql`SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = ${oldHash} LIMIT 1`;
  if (!stored || stored.revoked || new Date(stored.expires_at) < /* @__PURE__ */ new Date()) {
    return res.status(401).json({ code: 2, message: "token \u65E0\u6548\u6216\u5DF2\u8FC7\u671F" });
  }
  await sql`UPDATE refresh_tokens SET revoked = true WHERE id = ${stored.id}`;
  const [user] = await sql`SELECT id, tier, status, display_id FROM users WHERE id = ${stored.user_id}`;
  if (!user || user.status === 2) return res.status(403).json({ code: 3, message: `\u8D26\u53F7\u5DF2\u88AB\u5C01\u7981\uFF08\u7528\u6237 ID: ${user?.display_id || "#" + user?.id}\uFF09\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458` });
  const access_token = signAccessToken({ user_id: Number(user.id), display_id: user.display_id, tier: user.tier, role: "user" });
  const refresh_token = generateRefreshToken();
  const newHash = crypto2.createHash("sha256").update(refresh_token).digest("hex");
  await sql`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (${user.id}, ${newHash}, ${refreshExpiresAt().toISOString()})`;
  return res.status(200).json({ code: 0, data: { access_token, refresh_token, expires_in: 7200 } });
}
export {
  handler as default
};
