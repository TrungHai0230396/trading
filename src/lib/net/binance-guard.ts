/**
 * Shared egress guard for EVERY api.binance.com request this app makes.
 *
 * Threat model (public, free signup): all outbound exchange traffic leaves
 * from ONE VPS IP and the app is a SINGLE Node process. Any signed-up user
 * who hammers a Binance-backed route can get that shared IP rate-limited
 * (429) or banned (418) — which simultaneously breaks prices, portfolio,
 * live journal quotes and the shared consensus Telegram alerts for EVERY
 * user. Per-user route limits alone can't stop it: N users each under their
 * own limit still sum past Binance's IP ceiling.
 *
 * Three layers, applied in this order:
 *   1. TTL cache + in-flight coalescing — most requests never leave at all.
 *   2. Circuit breaker — one 429 stops ALL Binance egress instead of the
 *      caller immediately retrying and escalating it into a multi-hour 418.
 *   3. Weight-aware pacer — whatever does leave, leaves slowly. It DELAYS,
 *      it never rejects.
 *
 * Deliberately NOT built on `sharedBudget()` (lib/brokers/rate-limit.ts):
 * that hard-rejects once the allowance is gone, so an attacker could drain
 * it on purpose and starve the in-process consensus cron of its data —
 * converting a Binance-side ban into a self-inflicted one. A global ceiling
 * on this path may only slow callers down, never refuse them.
 *
 * The cache is a plain in-process Map, NOT Next's fetch cache. Do NOT
 * reintroduce `next: { revalidate }` here or in any caller: Next serves
 * stale-while-revalidate off disk, which handed traders days-old candles
 * after an idle gap (see the comment in scanner/candles.ts). A short
 * in-process TTL expires hard and dies with the process, so it can't lie
 * about the market.
 *
 * Kept free of `server-only` and node builtins on purpose: scanner/candles.ts
 * is imported by a client component, so anything it pulls in must also be
 * safe to bundle for the browser.
 */

const BASE = "https://api.binance.com";

/** "background" = the in-process cron. "interactive" = a user is waiting. */
export type BinancePriority = "background" | "interactive";

/**
 * Binance charges each endpoint an IP "request weight", and they differ by
 * more than an order of magnitude: /ticker/24hr for ONE symbol costs 2, the
 * same endpoint with no symbol costs 80. Pacing on request COUNT would make
 * the single most expensive call in the codebase (getTopBinanceUsdtSymbols)
 * look as cheap as a kline fetch.
 */
export const BINANCE_WEIGHT = {
  klines: 2,
  tickerPrice: 2,
  ticker24hSymbol: 2,
  ticker24hAll: 80,
} as const;

export class BinanceGuardError extends Error {
  constructor(
    message: string,
    /** Always set — either Binance's HTTP status or the breaker's 429/418. */
    readonly status: number,
    /** For 429/418: ms until Binance egress resumes. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "BinanceGuardError";
  }
}

// ─── Circuit breaker ────────────────────────────────────────────────────
// Binance escalates: repeated 429s become a 418 IP ban that can last hours.
// Today a caller that catches the throw fires the next request immediately
// (see scanner/runner.ts), which is exactly the behaviour that escalates.
// Once tripped, every caller fails FAST until the window passes.

const BREAKER_429_BASE_MS = 30_000;
// A 418 means we're already banned — assume minutes, not seconds.
const BREAKER_418_BASE_MS = 5 * 60_000;
const BREAKER_MAX_MS = 30 * 60_000;
// A single 429 after a calm stretch is not the same as the fifth in five
// minutes, so strikes fade instead of accumulating over the whole uptime.
const STRIKE_DECAY_MS = 15 * 60_000;

const breaker = { openUntil: 0, strikes: 0, lastTripAt: 0 };

function breakerRemainingMs(): number {
  return Math.max(0, breaker.openUntil - Date.now());
}

function tripBreaker(status: number, retryAfter: string | null): number {
  const now = Date.now();

  // Strikes count rate-limit EPISODES, not responses. Up to MAX_IN_FLIGHT
  // requests are already in the air when Binance starts refusing, and they
  // all come back 429 together — counting each would escalate to the maximum
  // back-off on the very first burst and black out market data for every
  // user for half an hour. A 429 arriving while the breaker is already open
  // is the same event: honour its Retry-After, don't escalate.
  if (breaker.openUntil <= now) {
    // Forgiveness is measured from when the previous window LIFTED, not from
    // the trip: a 30-minute ban would otherwise always outlast the decay and
    // reset itself, so repeat offences could never escalate.
    const calmSince = Math.max(breaker.lastTripAt, breaker.openUntil);
    if (now - calmSince > STRIKE_DECAY_MS) breaker.strikes = 0;
    breaker.strikes += 1;
    breaker.lastTripAt = now;
  }

  // Binance states the ban length in Retry-After on 418 and usually on 429.
  // Honour it, plus a margin so we don't resume the very instant it lapses.
  const seconds = Number(retryAfter);
  const fromHeader =
    Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 2_000 : 0;

  const base = status === 418 ? BREAKER_418_BASE_MS : BREAKER_429_BASE_MS;
  const escalated = Math.min(
    base * 2 ** (breaker.strikes - 1),
    BREAKER_MAX_MS,
  );
  breaker.openUntil = Math.max(
    breaker.openUntil,
    now + Math.max(fromHeader, escalated),
  );
  return breakerRemainingMs();
}

function bannedError(waitMs: number, status = 429): BinanceGuardError {
  const secs = Math.max(1, Math.ceil(waitMs / 1000));
  return new BinanceGuardError(
    `Binance đang tạm chặn máy chủ vì quá nhiều truy vấn. Dữ liệu Binance sẽ trở lại sau khoảng ${secs} giây.`,
    status,
    waitMs,
  );
}

// ─── Weight-aware pacer ─────────────────────────────────────────────────
// Binance's published /api/v3 ceiling is 6000 request-weight per minute per
// IP. We spend a fraction of it so the signed broker/spot calls (which do
// NOT come through here) still fit underneath, and so a burst of scanner
// traffic can't reach the ceiling in the first place. Token bucket, not a
// counter: callers that arrive with no budget WAIT for the refill.

const WEIGHT_PER_MINUTE = 2400;
/** Burst allowance. Must stay ≥ the heaviest single call (80) or it deadlocks. */
const WEIGHT_CAPACITY = 240;
/** Also cap raw sockets so one flood can't tie up the event loop. */
const MAX_IN_FLIGHT = 8;
const DEFAULT_TIMEOUT_MS = 10_000;

type QueueItem = { weight: number; run: () => void };

const queues: Record<BinancePriority, QueueItem[]> = {
  background: [],
  interactive: [],
};
let inFlight = 0;
let tokens = WEIGHT_CAPACITY;
let lastRefillAt = Date.now();
let pumpTimer: ReturnType<typeof setTimeout> | null = null;

function refill(): void {
  const now = Date.now();
  const elapsed = now - lastRefillAt;
  if (elapsed <= 0) return;
  lastRefillAt = now;
  tokens = Math.min(
    WEIGHT_CAPACITY,
    tokens + (elapsed * WEIGHT_PER_MINUTE) / 60_000,
  );
}

// The cron drains before interactive traffic. Interactive volume is
// attacker-controllable; a starved cron means every user's Telegram alerts
// silently stop, which is the failure this whole module exists to prevent.
function headLane(): QueueItem[] | null {
  if (queues.background.length > 0) return queues.background;
  if (queues.interactive.length > 0) return queues.interactive;
  return null;
}

function scheduleNextPump(): void {
  if (pumpTimer) return;
  // A freed slot pumps on release; no timer needed for that case.
  if (inFlight >= MAX_IN_FLIGHT) return;
  const head = headLane()?.[0];
  if (!head) return;
  const deficit = head.weight - tokens;
  const waitMs =
    deficit <= 0 ? 25 : Math.ceil((deficit * 60_000) / WEIGHT_PER_MINUTE) + 25;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, waitMs);
}

function pump(): void {
  refill();
  for (;;) {
    if (inFlight >= MAX_IN_FLIGHT) break;
    const lane = headLane();
    if (!lane) break;
    const item = lane[0];
    if (tokens < item.weight) break;
    lane.shift();
    tokens -= item.weight;
    inFlight += 1;
    item.run();
  }
  scheduleNextPump();
}

/** Resolves once this request may go out; the returned fn frees the slot. */
function acquire(
  weight: number,
  priority: BinancePriority,
): Promise<() => void> {
  return new Promise((resolve) => {
    queues[priority].push({
      weight,
      run: () => {
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          inFlight -= 1;
          pump();
        });
      },
    });
    pump();
  });
}

// ─── TTL cache + in-flight coalescing ───────────────────────────────────

type CacheEntry = { expiresAt: number; value: unknown };

const cache = new Map<string, CacheEntry>();
// Coalescing matters as much as the TTL: it is what turns 100 concurrent
// requests for the same symbol into ONE upstream call. The TTL alone only
// helps the 101st.
const inflightByKey = new Map<string, Promise<unknown>>();

// Kline payloads are large (a 300-bar response is tens of KB parsed), and
// this runs on a small VPS — so the map is capped, not just swept.
const CACHE_MAX_KEYS = 600;

function sweepCache(): void {
  if (cache.size <= CACHE_MAX_KEYS) return;
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  // Still over after dropping the expired ones (a wide burst of distinct
  // symbols): evict oldest-written first until back under the cap.
  for (const k of cache.keys()) {
    if (cache.size <= CACHE_MAX_KEYS) break;
    cache.delete(k);
  }
}

/**
 * Kline TTL — a small fraction of the bar interval, so the newest bar still
 * moves visibly for a trader watching the chart while repeat scans of the
 * same symbol cost nothing.
 */
const KLINE_TTL_MS: Record<string, number> = {
  "15m": 20_000,
  "1h": 45_000,
  "4h": 60_000,
  "1d": 90_000,
  "1w": 120_000,
  "1M": 120_000,
};

export function klineTtlMs(interval: string): number {
  return KLINE_TTL_MS[interval] ?? 30_000;
}

export type BinanceRequest = {
  /** Path under api.binance.com, e.g. "/api/v3/klines". */
  path: string;
  /** Query params. Order-independent — they are sorted into the cache key. */
  search?: Record<string, string>;
  /** How long the parsed response stays servable from memory. */
  ttlMs: number;
  /** Binance IP request weight for this endpoint — see BINANCE_WEIGHT. */
  weight: number;
  /** Defaults to "interactive". */
  priority?: BinancePriority;
  timeoutMs?: number;
};

async function fetchJson(url: URL, opts: BinanceRequest): Promise<unknown> {
  const release = await acquire(
    opts.weight,
    opts.priority ?? "interactive",
  );
  try {
    // Re-check after queueing: the breaker may have tripped while we waited,
    // and firing anyway is precisely how a 429 becomes a 418.
    const openMs = breakerRemainingMs();
    if (openMs > 0) throw bannedError(openMs);

    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (res.status === 429 || res.status === 418) {
      throw bannedError(
        tripBreaker(res.status, res.headers.get("retry-after")),
        res.status,
      );
    }
    if (!res.ok) {
      throw new BinanceGuardError(
        `Binance lỗi HTTP ${res.status}.`,
        res.status,
      );
    }
    return await res.json();
  } finally {
    release();
  }
}

/**
 * Fetch + parse a public Binance endpoint through cache → breaker → pacer.
 * Every api.binance.com call in the app should go through here.
 */
export async function binanceJson<T>(opts: BinanceRequest): Promise<T> {
  const url = new URL(opts.path, BASE);
  for (const [k, v] of Object.entries(opts.search ?? {})) {
    url.searchParams.set(k, v);
  }
  // Sorted so callers that build the same query in a different order still
  // share one cache slot — and therefore one upstream call.
  url.searchParams.sort();
  const key = `${url.pathname}?${url.searchParams.toString()}`;

  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inflightByKey.get(key);
  if (pending) return pending as Promise<T>;

  // Checked after the cache: a hit needs no egress, so it stays available
  // even while Binance is blocking us.
  const openMs = breakerRemainingMs();
  if (openMs > 0) throw bannedError(openMs);

  const job = fetchJson(url, opts).then((value) => {
    cache.set(key, { expiresAt: Date.now() + opts.ttlMs, value });
    sweepCache();
    return value;
  });
  inflightByKey.set(key, job);
  try {
    return (await job) as T;
  } finally {
    inflightByKey.delete(key);
  }
}

/** Snapshot for the admin monitoring page. */
export function binanceGuardStatus(): {
  breakerOpenMs: number;
  strikes: number;
  inFlight: number;
  queued: number;
  cachedKeys: number;
} {
  return {
    breakerOpenMs: breakerRemainingMs(),
    strikes: breaker.strikes,
    inFlight,
    queued: queues.background.length + queues.interactive.length,
    cachedKeys: cache.size,
  };
}
