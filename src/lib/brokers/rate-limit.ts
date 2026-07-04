/**
 * Per-process sliding-window rate limiter. Good enough for Phase 1
 * (one container, low write QPS). Move to Redis or DB-backed if we
 * ever go multi-instance.
 *
 * Use case: throttle credential-save endpoints so a malicious client
 * can't burn through HMAC verifications looking for valid signatures.
 */

const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}
