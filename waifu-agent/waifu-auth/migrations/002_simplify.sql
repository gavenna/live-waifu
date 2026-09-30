-- waifu-auth v2 简化 — 去手机号/密码/SMS，改为激活码+Tier
-- 在 Neon SQL Editor 中执行
-- 注意: 会清空旧数据

-- 清空旧数据（需要 CASCADE 因为外键约束）
DELETE FROM refresh_tokens;
DELETE FROM devices;
DELETE FROM reg_keys;
DELETE FROM users;

-- 删除短信验证码表
DROP TABLE IF EXISTS sms_codes;

-- 重构用户表: 去 phone/password，加 tier
ALTER TABLE users DROP COLUMN IF EXISTS phone;
ALTER TABLE users DROP COLUMN IF EXISTS password;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(10) NOT NULL DEFAULT 'trial';

-- 重构激活码表: 加 tier/device_limit/expires_at/status
ALTER TABLE reg_keys ADD COLUMN IF NOT EXISTS tier VARCHAR(10) NOT NULL DEFAULT 'trial';
ALTER TABLE reg_keys ADD COLUMN IF NOT EXISTS device_limit INT NOT NULL DEFAULT 1;
ALTER TABLE reg_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE reg_keys ADD COLUMN IF NOT EXISTS status SMALLINT NOT NULL DEFAULT 1;
-- 修改 used_by 列类型: VARCHAR → BIGINT (FK to users)
ALTER TABLE reg_keys ALTER COLUMN used_by TYPE BIGINT USING used_by::BIGINT;

-- 为过期但未设值的旧 key 设默认过期时间
UPDATE reg_keys SET expires_at = NOW() + INTERVAL '30 days' WHERE expires_at IS NULL;
ALTER TABLE reg_keys ALTER COLUMN expires_at SET NOT NULL;

-- 索引
CREATE INDEX IF NOT EXISTS idx_reg_keys_status ON reg_keys(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
