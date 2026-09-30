-- waifu-auth 全新初始化（合并 001-004）
-- 在 Neon SQL Editor 中完整执行
-- https://console.neon.tech → 选项目 → SQL Editor

-- ═══════════════════════════════════════
-- 用户表
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    display_id    VARCHAR(10) UNIQUE,
    tier          VARCHAR(10) NOT NULL DEFAULT 'trial',
    device_limit  INT DEFAULT 1,
    status        SMALLINT DEFAULT 1,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);

-- ═══════════════════════════════════════
-- 设备绑定表
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS devices (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    machine_code VARCHAR(64) UNIQUE NOT NULL,
    device_name  VARCHAR(100) DEFAULT '',
    last_seen    TIMESTAMPTZ DEFAULT NOW(),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- ═══════════════════════════════════════
-- Refresh Token 表
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ═══════════════════════════════════════
-- 激活码表
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS reg_keys (
    id           BIGSERIAL PRIMARY KEY,
    key          VARCHAR(20) UNIQUE NOT NULL,
    tier         VARCHAR(10) NOT NULL DEFAULT 'trial',
    device_limit INT NOT NULL DEFAULT 1,
    status       SMALLINT NOT NULL DEFAULT 1,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_by   BIGINT,
    used_by      BIGINT,
    used_at      TIMESTAMPTZ,
    note         VARCHAR(255) DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reg_keys_status ON reg_keys(status, expires_at);

-- ═══════════════════════════════════════
-- 管理员表
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS admins (
    id         BIGSERIAL PRIMARY KEY,
    username   VARCHAR(50) UNIQUE NOT NULL,
    password   VARCHAR(128) NOT NULL,
    role       VARCHAR(20) DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初始超级管理员 (密码: admin123)
INSERT INTO admins (username, password, role)
VALUES ('admin', '$2a$10$2z96FMcjV5p.h.1uHkeXuOAu2k1PLQLwlf6drvNx8a5/3eWwKHj.i', 'superadmin')
ON CONFLICT (username) DO NOTHING;
