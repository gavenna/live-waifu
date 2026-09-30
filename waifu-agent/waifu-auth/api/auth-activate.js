// api-src/auth-activate.ts
import crypto2 from "crypto";

// api-src/_lib/db.ts
import { neon } from "@neondatabase/serverless";
var DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.warn("[db] DATABASE_URL not set \u2014 DB calls will fail");
}
var sql = neon(DATABASE_URL);

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

// api-src/auth-activate.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ code: 1, message: "Method Not Allowed" });
  const ip = req.headers["x-forwarded-for"] || "unknown";
  if (!rateLimit(`activate:${ip}`, 5, 3600)) {
    return res.status(429).json({ code: 429, message: "\u64CD\u4F5C\u8FC7\u4E8E\u9891\u7E41" });
  }
  const { activation_code, machine_code, device_name } = req.body || {};
  if (!machine_code) return res.status(400).json({ code: 1, message: "\u7F3A\u5C11\u673A\u5668\u7801" });
  const [existingDevice] = await sql`
    SELECT d.user_id, u.tier, u.status, u.display_id, u.device_limit
    FROM devices d
    JOIN users u ON u.id = d.user_id
    WHERE d.machine_code = ${machine_code}
    LIMIT 1
  `;
  if (existingDevice) {
    if (existingDevice.status === 2) return res.status(403).json({ code: 4, message: `\u8D26\u53F7\u5DF2\u88AB\u5C01\u7981\uFF08\u7528\u6237 ID: ${existingDevice.display_id || "#" + existingDevice.user_id}\uFF09\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458` });
    await sql`UPDATE devices SET last_seen = NOW(), device_name = ${device_name || ""} WHERE machine_code = ${machine_code}`;
    const access_token2 = signAccessToken({ user_id: Number(existingDevice.user_id), display_id: existingDevice.display_id, tier: existingDevice.tier, role: "user" });
    const refresh_token2 = generateRefreshToken();
    const token_hash2 = crypto2.createHash("sha256").update(refresh_token2).digest("hex");
    await sql`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (${existingDevice.user_id}, ${token_hash2}, ${refreshExpiresAt().toISOString()})`;
    return res.status(200).json({
      code: 0,
      data: {
        access_token: access_token2,
        refresh_token: refresh_token2,
        expires_in: 7200,
        tier: existingDevice.tier,
        device_limit: Number(existingDevice.device_limit),
        device_count: 1,
        reauth: true
      }
    });
  }
  if (!activation_code) return res.status(400).json({ code: 1, message: "\u8BF7\u8F93\u5165\u6FC0\u6D3B\u7801" });
  const [keyData] = await sql`
    SELECT id, key, tier, device_limit, expires_at, used_by
    FROM reg_keys
    WHERE key = ${activation_code} AND status = 1
    LIMIT 1
  `;
  if (!keyData) return res.status(400).json({ code: 2, message: "\u6FC0\u6D3B\u7801\u65E0\u6548\u6216\u5DF2\u88AB\u4F7F\u7528" });
  if (new Date(keyData.expires_at) < /* @__PURE__ */ new Date()) return res.status(400).json({ code: 3, message: "\u6FC0\u6D3B\u7801\u5DF2\u8FC7\u671F" });
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const mkDisplayId = () => "U-" + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * 32)]).join("");
  let displayId = mkDisplayId();
  for (let i = 0; i < 10; i++) {
    const [dup] = await sql`SELECT id FROM users WHERE display_id = ${displayId} LIMIT 1`;
    if (!dup) break;
    displayId = mkDisplayId();
  }
  const tier = keyData.tier || "trial";
  const deviceLimit = Number(keyData.device_limit || 1);
  const [user] = await sql`INSERT INTO users (tier, device_limit, display_id) VALUES (${tier}, ${deviceLimit}, ${displayId}) RETURNING id, tier, device_limit, display_id`;
  if (!user) return res.status(500).json({ code: 99, message: "\u670D\u52A1\u5668\u9519\u8BEF" });
  await sql`INSERT INTO devices (user_id, machine_code, device_name) VALUES (${user.id}, ${machine_code}, ${device_name || ""})`;
  const access_token = signAccessToken({ user_id: Number(user.id), display_id: user.display_id, tier: user.tier, role: "user" });
  const refresh_token = generateRefreshToken();
  const token_hash = crypto2.createHash("sha256").update(refresh_token).digest("hex");
  await sql`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (${user.id}, ${token_hash}, ${refreshExpiresAt().toISOString()})`;
  await sql`UPDATE reg_keys SET status = 2, used_by = ${user.id}, used_at = NOW() WHERE id = ${keyData.id}`;
  return res.status(200).json({
    code: 0,
    data: { access_token, refresh_token, expires_in: 7200, tier: user.tier, device_limit: Number(user.device_limit), device_count: 1 }
  });
}
export {
  handler as default
};
