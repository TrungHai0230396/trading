/**
 * Per-process sliding-window rate limiter. Good enough for Phase 1
 * (one container, low write QPS). Move to Redis or DB-backed if we
 * ever go multi-instance.
 *
 * Use case: throttle credential-save endpoints so a malicious client
 * can't burn through HMAC verifications looking for valid signatures.
 */

const hits = new Map<string, number[]>();

// Keys include unauthenticated input (`login:<email>` accepts any email), so
// the map must not grow forever. Above this size, sweep entries whose newest
// hit is older than the longest window we use (1h) — an hour-old key can't
// influence any current limit.
const SWEEP_THRESHOLD = 10_000;
const MAX_WINDOW_MS = 60 * 60_000;

function sweep(now: number): void {
  if (hits.size < SWEEP_THRESHOLD) return;
  for (const [k, arr] of hits) {
    const newest = arr[arr.length - 1] ?? 0;
    if (now - newest > MAX_WINDOW_MS) hits.delete(k);
  }
}

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  sweep(now);
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

// ─── Global (not per-user) budget for a SHARED upstream key ─────────────
// Gemini and TwelveData run on ONE api key billed to the owner. A per-user
// rate limit alone can't protect them: N users each under their own limit
// still sum past the shared free-tier quota (and open registration would
// multiply it). This meters the key ITSELF, keyed on the service name, so
// every caller/route draws from the same allowance. When exhausted the
// caller should surface a friendly "try later" — never burn past it.
//
// Two windows must BOTH pass: a per-minute rate (matches the provider's
// RPM) and a per-day cap (matches the daily quota). We only record a hit
// when the call is actually allowed, so the buckets don't drift.
type BudgetBucket = { minute: number[]; day: number[] };
const budgets = new Map<string, BudgetBucket>();
const DAY_MS = 24 * 60 * 60_000;

export function sharedBudget(
  service: string,
  perMinute: number,
  perDay: number,
): boolean {
  const now = Date.now();
  const b = budgets.get(service) ?? { minute: [], day: [] };
  b.minute = b.minute.filter((t) => now - t < 60_000);
  b.day = b.day.filter((t) => now - t < DAY_MS);
  budgets.set(service, b);

  if (b.minute.length >= perMinute || b.day.length >= perDay) return false;

  b.minute.push(now);
  b.day.push(now);
  return true;
}
