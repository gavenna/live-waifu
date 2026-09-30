import type { Handler } from '@netlify/functions';
import crypto from 'crypto';
import { sql } from '../../lib/db.js';
import { rateLimit } from '../../lib/limiter.js';
import { signAccessToken, generateRefreshToken, refreshExpiresAt } from '../../lib/jwt.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const ip = event.headers['x-forwarded-for'] || 'unknown';
  if (!rateLimit(`activate:${ip}`, 5, 3600)) {
    return { statusCode: 429, body: JSON.stringify({ code: 429, message: '操作过于频繁' }) };
  }

  let body: any;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ code: 1, message: '无效的请求格式' }) };
  }

  const { activation_code, machine_code, device_name } = body;
  if (!activation_code) {
    return { statusCode: 400, body: JSON.stringify({ code: 1, message: '请输入激活码' }) };
  }
  if (!machine_code) {
    return { statusCode: 400, body: JSON.stringify({ code: 1, message: '缺少机器码' }) };
  }

  // 校验激活码
  const [keyData] = await sql`
    SELECT id, key, tier, device_limit, expires_at, used_by
    FROM reg_keys
    WHERE key = ${activation_code} AND status = 1
    LIMIT 1
  `;
  if (!keyData) {
    return { statusCode: 400, body: JSON.stringify({ code: 2, message: '激活码无效或已被使用' }) };
  }
  if (new Date(keyData.expires_at) < new Date()) {
    return { statusCode: 400, body: JSON.stringify({ code: 3, message: '激活码已过期' }) };
  }

  // 设备已绑定？→ 直接恢复登录，不消费激活码
  const [existingDevice] = await sql`
    SELECT d.user_id, u.tier, u.status, u.display_id, u.device_limit
    FROM devices d
    JOIN users u ON u.id = d.user_id
    WHERE d.machine_code = ${machine_code}
    LIMIT 1
  `;
  if (existingDevice) {
    if (existingDevice.status === 2) {
      return { statusCode: 403, body: JSON.stringify({ code: 4, message: '账号已被封禁，请联系管理员' }) };
    }
    // 更新设备最后上线
    await sql`UPDATE devices SET last_seen = NOW(), device_name = ${device_name || ''} WHERE machine_code = ${machine_code}`;
    // 直接签发 token
    const access_token = signAccessToken({ user_id: Number(existingDevice.user_id), display_id: existingDevice.display_id, tier: existingDevice.tier, role: 'user' });
    const refresh_token = generateRefreshToken();
    const token_hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    await sql`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES (${existingDevice.user_id}, ${token_hash}, ${refreshExpiresAt().toISOString()})
    `;
    return {
      statusCode: 200,
      body: JSON.stringify({
        code: 0,
        data: {
          access_token,
          refresh_token,
          expires_in: 7200,
          tier: existingDevice.tier,
          device_limit: Number(existingDevice.device_limit),
          device_count: 1,
          reauth: true,  // 标记为恢复登录
        },
      }),
    };
  }

  // 生成展示 ID
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const mkDisplayId = () => 'U-' + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * 32)]).join('');
  let displayId = mkDisplayId();
  let attempts = 0;
  while (attempts < 10) {
    const [dup] = await sql`SELECT id FROM users WHERE display_id = ${displayId} LIMIT 1`;
    if (!dup) break;
    displayId = mkDisplayId();
    attempts++;
  }

  // 创建用户
  const tier = keyData.tier || 'trial';
  const deviceLimit = Number(keyData.device_limit || 1);
  const [user] = await sql`
    INSERT INTO users (tier, device_limit, display_id)
    VALUES (${tier}, ${deviceLimit}, ${displayId})
    RETURNING id, tier, device_limit, display_id
  `;
  if (!user) {
    return { statusCode: 500, body: JSON.stringify({ code: 99, message: '服务器错误' }) };
  }

  // 绑定设备
  await sql`
    INSERT INTO devices (user_id, machine_code, device_name)
    VALUES (${user.id}, ${machine_code}, ${device_name || ''})
  `;

  // 签发 token
  const access_token = signAccessToken({ user_id: Number(user.id), display_id: user.display_id, tier: user.tier, role: 'user' });
  const refresh_token = generateRefreshToken();
  const token_hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
  await sql`
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES (${user.id}, ${token_hash}, ${refreshExpiresAt().toISOString()})
  `;

  // 标记激活码已使用
  await sql`UPDATE reg_keys SET status = 2, used_by = ${user.id}, used_at = NOW() WHERE id = ${keyData.id}`;

  return {
    statusCode: 200,
    body: JSON.stringify({
      code: 0,
      data: {
        access_token,
        refresh_token,
        expires_in: 7200,
        tier: user.tier,
        device_limit: Number(user.device_limit),
        device_count: 1,
      },
    }),
  };
};
