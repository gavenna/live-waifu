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
function decodeAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
  } catch {
    return null;
  }
}

// api-src/auth-verify.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ code: 1, message: "Method Not Allowed" });
  const auth = req.headers["authorization"] || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ code: 1, message: "\u672A\u63D0\u4F9B token" });
  const payload = decodeAccessToken(match[1]);
  if (!payload) return res.status(401).json({ code: 2, message: "token \u65E0\u6548" });
  const [user] = await sql`SELECT id, display_id, tier, device_limit, status FROM users WHERE id = ${payload.user_id} LIMIT 1`;
  if (!user) return res.status(404).json({ code: 3, message: "\u7528\u6237\u4E0D\u5B58\u5728" });
  if (user.status === 2) return res.status(403).json({ code: 4, message: `\u8D26\u53F7\u5DF2\u88AB\u5C01\u7981\uFF08\u7528\u6237 ID: ${user.display_id || "#" + user.id}\uFF09\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458` });
  const mc = req.query.machine_code || "";
  if (mc) {
    const [dev] = await sql`SELECT id FROM devices WHERE user_id = ${payload.user_id} AND machine_code = ${mc} LIMIT 1`;
    if (!dev) return res.status(403).json({ code: 5, message: "\u8BBE\u5907\u5DF2\u88AB\u89E3\u7ED1\uFF0C\u8BF7\u91CD\u65B0\u6FC0\u6D3B" });
  }
  return res.status(200).json({
    code: 0,
    data: {
      user_id: Number(user.id),
      display_id: user.display_id,
      tier: user.tier,
      device_limit: Number(user.device_limit),
      status: user.status
    }
  });
}
export {
  handler as default
};
