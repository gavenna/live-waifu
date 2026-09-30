import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const ACCESS_EXPIRES = '2h';
const REFRESH_EXPIRES_SEC = 30 * 24 * 3600; // 30 days

export interface AccessPayload {
  user_id: number;
  display_id: string;
  tier: string;
  role: string;
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function verifyAccessToken(token: string): AccessPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AccessPayload;
  } catch {
    return null;
  }
}

/** 仅解码验证签名，不检查过期（Gitee 不通时的兜底校验用） */
export function decodeAccessToken(token: string): AccessPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as AccessPayload;
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function refreshExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_EXPIRES_SEC * 1000);
}
