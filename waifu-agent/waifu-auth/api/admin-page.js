// api-src/admin-page.ts
import { readFileSync } from "fs";
import { resolve } from "path";
var PAGE_PASSWORD = process.env.ADMIN_PAGE_PASSWORD || "";
function checkBasicAuth(req) {
  if (!PAGE_PASSWORD) return true;
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) return false;
  try {
    const encoded = auth.slice(6);
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [, password] = decoded.split(":");
    return password === PAGE_PASSWORD;
  } catch {
    return false;
  }
}
async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ code: 1, message: "Method Not Allowed" });
  }
  if (!checkBasicAuth(req)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Panel", charset="UTF-8"');
    return res.status(401).send("Authentication required");
  }
  try {
    const html = readFileSync(resolve(process.cwd(), "public/admin.html"), "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch {
    return res.status(500).json({ code: 1, message: "Failed to load admin page" });
  }
}
export {
  handler as default
};
