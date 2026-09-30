import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 页面级 Basic Auth 密码（与 admin 登录密码不同，这是看门密码）
// 在 Vercel 环境变量中设置 ADMIN_PAGE_PASSWORD，不设置则允许所有人访问
const PAGE_PASSWORD = process.env.ADMIN_PAGE_PASSWORD || '';

function checkBasicAuth(req: VercelRequest): boolean {
  if (!PAGE_PASSWORD) return true; // 未配置 → 允许访问（向后兼容，部署后务必设置）

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;

  try {
    const encoded = auth.slice(6);
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [, password] = decoded.split(':');
    return password === PAGE_PASSWORD;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ code: 1, message: 'Method Not Allowed' });
  }

  if (!checkBasicAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel", charset="UTF-8"');
    return res.status(401).send('Authentication required');
  }

  try {
    const html = readFileSync(resolve(process.cwd(), 'public/admin.html'), 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch {
    return res.status(500).json({ code: 1, message: 'Failed to load admin page' });
  }
}
