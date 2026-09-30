import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { sql } from './_lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ code: 1, message: 'Method Not Allowed' });

  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ code: 1, message: '缺少 refresh_token' });

  const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
  await sql`UPDATE refresh_tokens SET revoked = true WHERE token_hash = ${hash}`;
  return res.status(200).json({ code: 0, message: '已退出' });
}
