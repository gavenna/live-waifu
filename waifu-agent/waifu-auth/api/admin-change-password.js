// api-src/admin-change-password.ts
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

// api-src/admin-change-password.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ code: 1, message: "Method Not Allowed" });
  const auth = authenticate(req.headers);
  if (!auth || auth.user.role !== "admin" && auth.user.role !== "superadmin") {
    return res.status(401).json({ code: 1, message: "\u672A\u6388\u6743" });
  }
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ code: 1, message: "\u7F3A\u5C11\u65E7\u5BC6\u7801\u6216\u65B0\u5BC6\u7801" });
  if (new_password.length < 6) return res.status(400).json({ code: 1, message: "\u65B0\u5BC6\u7801\u81F3\u5C116\u4F4D" });
  const [admin] = await sql`SELECT id, password FROM admins WHERE id = ${auth.user.user_id} LIMIT 1`;
  if (!admin) return res.status(404).json({ code: 1, message: "\u7BA1\u7406\u5458\u4E0D\u5B58\u5728" });
  const valid = await bcrypt.compare(old_password, admin.password);
  if (!valid) return res.status(401).json({ code: 1, message: "\u65E7\u5BC6\u7801\u9519\u8BEF" });
  const hash = await bcrypt.hash(new_password, 10);
  await sql`UPDATE admins SET password = ${hash} WHERE id = ${admin.id}`;
  return res.status(200).json({ code: 0, message: "\u5BC6\u7801\u5DF2\u4FEE\u6539" });
}
export {
  handler as default
};
