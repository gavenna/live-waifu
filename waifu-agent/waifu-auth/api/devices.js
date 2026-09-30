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

// api-src/devices.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  const auth = authenticate(req.headers);
  if (!auth) return res.status(401).json({ code: 1, message: "\u8BF7\u5148\u767B\u5F55" });
  if (req.method === "POST" && req.body?.machine_code) {
    const { machine_code, device_name } = req.body || {};
    const [user] = await sql`SELECT id, device_limit, status FROM users WHERE id = ${auth.user.user_id} LIMIT 1`;
    if (!user || user.status === 2) return res.status(403).json({ code: 3, message: "\u8D26\u53F7\u5F02\u5E38" });
    const limit = Number(user.device_limit || 1);
    const existing = await sql`SELECT id, machine_code FROM devices WHERE user_id = ${auth.user.user_id}`;
    const thisMachine = existing.find((d) => d.machine_code === machine_code);
    const others = existing.filter((d) => d.machine_code !== machine_code);
    if (!thisMachine && others.length >= limit) {
      return res.status(400).json({ code: 2, message: `\u8BBE\u5907\u6570\u5DF2\u8FBE\u4E0A\u9650 (${limit})` });
    }
    await sql`INSERT INTO devices (user_id, machine_code, device_name, last_seen) VALUES (${auth.user.user_id}, ${machine_code}, ${device_name || ""}, NOW()) ON CONFLICT (machine_code) DO UPDATE SET last_seen = NOW()`;
    return res.status(200).json({ code: 0, data: { bound: true, total: others.length + 1, limit } });
  }
  if (req.method === "DELETE" || req.method === "POST" && (req.body?.id || req.query?.id)) {
    const deviceId = parseInt(req.query?.id || req.body?.id || "0");
    if (!deviceId) return res.status(400).json({ code: 1, message: "\u7F3A\u5C11\u8BBE\u5907 ID" });
    const [device] = await sql`SELECT id FROM devices WHERE id = ${deviceId} AND user_id = ${auth.user.user_id} LIMIT 1`;
    if (!device) return res.status(404).json({ code: 2, message: "\u8BBE\u5907\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u64CD\u4F5C" });
    await sql`DELETE FROM devices WHERE id = ${deviceId}`;
    return res.status(200).json({ code: 0, message: "\u5DF2\u89E3\u7ED1" });
  }
  if (req.method === "GET") {
    const machine_code = req.query?.machine_code || "";
    if (machine_code) {
      const [user] = await sql`SELECT status FROM users WHERE id = ${auth.user.user_id} LIMIT 1`;
      if (!user || user.status === 2) return res.status(403).json({ code: 3, message: "\u8D26\u53F7\u5DF2\u88AB\u5C01\u7981" });
      const [dev] = await sql`SELECT id FROM devices WHERE user_id = ${auth.user.user_id} AND machine_code = ${machine_code} LIMIT 1`;
      return res.status(200).json({ code: 0, data: { user_id: Number(auth.user.user_id), tier: auth.user.tier, device_bound: !!dev } });
    }
    const devices = await sql`SELECT id, machine_code, device_name, last_seen, created_at FROM devices WHERE user_id = ${auth.user.user_id} ORDER BY last_seen DESC`;
    return res.status(200).json({ code: 0, data: devices });
  }
  return res.status(405).json({ code: 1, message: "Method Not Allowed" });
}
export {
  handler as default
};
