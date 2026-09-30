// api-src/auth-logout.ts
import crypto from "crypto";

// api-src/_lib/db.ts
import { neon } from "@neondatabase/serverless";
var DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.warn("[db] DATABASE_URL not set \u2014 DB calls will fail");
}
var sql = neon(DATABASE_URL);

// api-src/auth-logout.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ code: 1, message: "Method Not Allowed" });
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ code: 1, message: "\u7F3A\u5C11 refresh_token" });
  const hash = crypto.createHash("sha256").update(refresh_token).digest("hex");
  await sql`UPDATE refresh_tokens SET revoked = true WHERE token_hash = ${hash}`;
  return res.status(200).json({ code: 0, message: "\u5DF2\u9000\u51FA" });
}
export {
  handler as default
};
