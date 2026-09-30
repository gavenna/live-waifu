import type { Handler } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { sql } from '../../lib/db.js';
import { authenticate } from '../../lib/auth.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = authenticate(event.headers);
  if (!auth || (auth.user.role !== 'admin' && auth.user.role !== 'superadmin')) {
    return { statusCode: 401, body: JSON.stringify({ code: 1, message: '未授权' }) };
  }

  let body: any;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ code: 1, message: '无效的请求格式' }) };
  }

  const { old_password, new_password } = body;
  if (!old_password || !new_password) {
    return { statusCode: 400, body: JSON.stringify({ code: 1, message: '请输入旧密码和新密码' }) };
  }
  if (new_password.length < 6) {
    return { statusCode: 400, body: JSON.stringify({ code: 1, message: '新密码至少 6 位' }) };
  }

  const [admin] = await sql`SELECT id, password FROM admins WHERE id = ${auth.user.user_id} LIMIT 1`;
  if (!admin || !bcrypt.compareSync(old_password, admin.password)) {
    return { statusCode: 401, body: JSON.stringify({ code: 2, message: '旧密码错误' }) };
  }

  const hash = bcrypt.hashSync(new_password, 10);
  await sql`UPDATE admins SET password = ${hash} WHERE id = ${auth.user.user_id}`;

  return { statusCode: 200, body: JSON.stringify({ code: 0, message: '密码已修改' }) };
};
