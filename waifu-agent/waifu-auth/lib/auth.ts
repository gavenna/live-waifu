import { verifyAccessToken, AccessPayload } from './jwt.js';

export interface AuthContext {
  user: AccessPayload;
}

/** Extract Bearer token from Authorization header and verify. Returns payload or null. */
export function authenticate(headers: Record<string, string | undefined>): AuthContext | null {
  const auth = headers['authorization'] || headers['Authorization'] || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = verifyAccessToken(match[1]);
  if (!payload) return null;
  return { user: payload };
}
