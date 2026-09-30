import type { Handler } from '@netlify/functions';
import { sql } from '../../lib/db.js';
import { authenticate } from '../../lib/auth.js';

export const handler: Handler = async (event) => {
  const auth = authenticate(event.headers);
  if (!auth || (auth.user.role !== 'admin' && auth.user.role !== 'superadmin')) {
    return { statusCode: 401, body: JSON.stringify({ code: 1, message: '未授权' }) };
  }
  const [[uc], [dc], [tc], [bc]] = await Promise.all([
    sql`SELECT COUNT(*)::int as c FROM users`,
    sql`SELECT COUNT(*)::int as c FROM devices`,
    sql`SELECT COUNT(*)::int as c FROM refresh_tokens WHERE revoked = false`,
    sql`SELECT COUNT(*)::int as c FROM users WHERE status = 2`,
  ]);
  return { statusCode: 200, body: JSON.stringify({ code: 0, data: { total_users: uc?.c || 0, banned_users: bc?.c || 0, total_devices: dc?.c || 0, active_sessions: tc?.c || 0 } }) };
};
