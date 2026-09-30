// 生成激活码
// 用法: npx tsx gen-key.ts [--tier trial|pro|dev] [--count N] [--expires-days 30] [--note "备注"]
//
// 环境变量: DATABASE_URL (Neon 连接串) 或 .env 文件

import { readFileSync } from 'fs';
import { resolve } from 'path';

// 加载 .env
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf-8');
  env.split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  });
} catch { /* no .env */ }

import { neon } from '@neondatabase/serverless';

const DB = process.env.DATABASE_URL || '';
if (!DB) { console.error('请先设 DATABASE_URL 环境变量'); process.exit(1); }

const sql = neon(DB);

// 解析参数
const args = process.argv.slice(2);
let tier = 'pro';
let count = 1;
let expiresDays = 30;
let note = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tier' && args[i + 1]) { tier = args[++i]; }
  else if (args[i] === '--count' && args[i + 1]) { count = parseInt(args[++i]); }
  else if (args[i] === '--expires-days' && args[i + 1]) { expiresDays = parseInt(args[++i]); }
  else if (args[i] === '--note' && args[i + 1]) { note = args[++i]; }
  else if (/^\d+$/.test(args[i])) { count = parseInt(args[i]); }
}

if (!['trial', 'pro', 'dev'].includes(tier)) {
  console.error('tier 必须是 trial, pro 或 dev');
  process.exit(1);
}

const TIER_PREFIX: Record<string, string> = {
  trial: 'WA-TRY',
  pro: 'WA-PRO',
  dev: 'WA-DEV',
};
const DEVICE_LIMIT: Record<string, number> = {
  trial: 1,
  pro: 3,
  dev: 5,
};

const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const key = (prefix: string) =>
  prefix + '-' +
  Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * 32)]).join('') + '-' +
  Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * 32)]).join('');

const prefix = TIER_PREFIX[tier];
const deviceLimit = DEVICE_LIMIT[tier];
const expiresAt = new Date(Date.now() + expiresDays * 86400_000).toISOString();

(async () => {
  for (let i = 0; i < count; i++) {
    const k = key(prefix);
    await sql`INSERT INTO reg_keys (key, tier, device_limit, expires_at, note) VALUES (${k}, ${tier}, ${deviceLimit}, ${expiresAt}, ${note})`;
    console.log(k);
  }
  console.log(`\ntier: ${tier} | 设备上限: ${deviceLimit} | 有效期: ${expiresDays} 天 (至 ${expiresAt})`);
  console.log(`已生成 ${count} 个激活码`);
})();
