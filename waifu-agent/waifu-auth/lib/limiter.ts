// In-memory rate limiter. Resets on cold start (acceptable for Netlify).
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowSec: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    if (now > v.resetAt) hits.delete(k);
  }
}, 10 * 60 * 1000);
