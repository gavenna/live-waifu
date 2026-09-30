-- waifu-auth 初始化数据库 (v2 — 激活码模式)
-- 在 Neon SQL Editor 中执行

-- 用户表 (无手机号, 无密码)
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    tier          VARCHAR(10) NOT NULL DEFAULT 'trial',     -- trial/pro/dev
    device_limit  INT DEFAULT 1,
    status        SMALLINT DEFAULT 1,                       -- 1=正常, 2=封禁
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 设备绑定表
CREATE TABLE IF NOT EXISTS devices (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    machine_code VARCHAR(64) UNIQUE NOT NULL,
    device_name  VARCHAR(100) DEFAULT '',
    last_seen    TIMESTAMPTZ DEFAULT NOW(),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- refresh_token 表
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- 激活码表
CREATE TABLE IF NOT EXISTS reg_keys (
    id           BIGSERIAL PRIMARY KEY,
    key          VARCHAR(20) UNIQUE NOT NULL,               -- WA-PRO-XXXX
    tier         VARCHAR(10) NOT NULL DEFAULT 'trial',      -- trial/pro/dev
    device_limit INT NOT NULL DEFAULT 1,
    status       SMALLINT NOT NULL DEFAULT 1,               -- 1=未用, 2=已用, 3=过期
    expires_at   TIMESTAMPTZ NOT NULL,
    created_by   BIGINT,
    used_by      BIGINT,
    used_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reg_keys_status ON reg_keys(status, expires_at);

-- 管理员表
CREATE TABLE IF NOT EXISTS admins (
    id         BIGSERIAL PRIMARY KEY,
    username   VARCHAR(50) UNIQUE NOT NULL,
    password   VARCHAR(128) NOT NULL,                       -- bcrypt 哈希
    role       VARCHAR(20) DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初始超级管理员 (密码: admin123)
INSERT INTO admins (username, password, role)
VALUES ('admin', '$2a$10$2z96FMcjV5p.h.1uHkeXuOAu2k1PLQLwlf6drvNx8a5/3eWwKHj.i', 'superadmin')
ON CONFLICT (username) DO NOTHING;
