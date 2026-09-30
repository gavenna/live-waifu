import type { Handler } from '@netlify/functions';
import crypto from 'crypto';
import { sql } from '../../lib/db.js';
import { signAccessToken, generateRefreshToken, refreshExpiresAt } from '../../lib/jwt.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = event.headers['authorization'] || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { statusCode: 401, body: JSON.stringify({ code: 1, message: '未提供 refresh_token' }) };

  const oldHash = crypto.createHash('sha256').update(match[1]).digest('hex');
  const [stored] = await sql`SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = ${oldHash} LIMIT 1`;
  if (!stored || stored.revoked || new Date(stored.expires_at) < new Date()) {
    return { statusCode: 401, body: JSON.stringify({ code: 2, message: 'token 无效或已过期' }) };
  }

  await sql`UPDATE refresh_tokens SET revoked = true WHERE id = ${stored.id}`;

  const [user] = await sql`SELECT id, tier, status, display_id FROM users WHERE id = ${stored.user_id}`;
  if (!user || user.status === 2) return { statusCode: 403, body: JSON.stringify({ code: 3, message: '账号已被封禁' }) };

  const access_token = signAccessToken({ user_id: Number(user.id), display_id: user.display_id, tier: user.tier, role: 'user' });
  const refresh_token = generateRefreshToken();
  const newHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
  await sql`
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES (${user.id}, ${newHash}, ${refreshExpiresAt().toISOString()})
  `;

  return { statusCode: 200, body: JSON.stringify({ code: 0, data: { access_token, refresh_token, expires_in: 7200 } }) };
};
