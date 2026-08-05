/**
 * Level watch — DM the user when live price reaches an SL or TP THEY
 * recorded on a trade they still have OPEN.
 *
 * Opt-in (default OFF, see PersonalDmPrefs). This is an observation about
 * the user's own written-down plan, not a suggestion: the message states
 * that the level was reached and points at the journal. It never says what
 * to do with the position.
 *
 * Fires ONCE per transition, then latches: per-trade fired state lives in
 * AppSetting the way consensus-scan keeps its per-symbol state, and stays
 * set for as long as that trade is open at that level, so price wobbling
 * across a stop can't re-send. Same trick as the `symbol@timeframes` key
 * there, the state key carries the LEVEL VALUE — moving a stop re-arms the
 * alert on the new number instead of going quiet.
 *
 * CRYPTO only. Forex quotes come from TwelveData on a shared daily budget
 * (see quotes/twelvedata.ts) that also serves the calculator and the
 * journal's live quotes; a background loop polling it every few minutes
 * would drain that budget and break those pages for everyone. Crypto goes
 * through the Binance egress guard, which caches, paces and coalesces.
 */

import "server-only";
import { db } from "@/lib/db";
import { getPrice } from "@/lib/quotes";
import { BinanceError } from "@/lib/quotes/binance";
import { notifyUser, telegramEnabled } from "@/lib/notify/telegram";
import { getPersonalDmPrefsMap } from "@/lib/notify/consensus-config";

const STATE_KEY = "alert:level-watch";

/**
 * Small VPS: bounds on how much work ONE tick may create. They bound the
 * WORK, never WHO gets served: every limit below is walked from a rotating
 * start (see `tickCursor`), so whatever a tick has to leave out leads the
 * queue on the next one, three minutes later.
 *
 * A single global `take` is what must not come back: ordered by openedAt it
 * hands the whole budget to whoever opened positions most recently, and once
 * the userbase collectively holds more than the cap, everyone sorted past the
 * cut gets NO alert at all — every tick, forever, and silently, because alt
 * positions barely overlap beyond BTC/ETH.
 */
const MAX_TRADES_PER_USER = 100;
const MAX_TRADES = 1000;
const MAX_SYMBOLS = 60;

/**
 * Advances once per tick and rotates the starting point of the bounded loops.
 * In-process is enough — the cron is in-process too (instrumentation.ts) —
 * and a restart only resets the rotation; it cannot park a user at the tail.
 */
let tickCursor = 0;

/**
 * Symbols Binance rejected as unknown. A free-typed pair in one user's
 * journal would otherwise cost a request on every single tick, forever.
 */
const UNPRICEABLE_TTL_MS = 60 * 60_000;
const unpriceableUntil = new Map<string, number>();

/** `${tradeId}:SL@${level}` → true. Presence means "already alerted". */
type WatchState = Record<string, boolean>;

type OpenTrade = {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
};

type UserWork = {
  trades: OpenTrade[];
  /** true = this tick could not read ALL of the user's open trades. */
  truncated: boolean;
};

type Hit = {
  key: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  kind: "SL" | "TP";
  level: number;
};

// ──────────────────────────────────────────────────────────────────────
// Level semantics
// ──────────────────────────────────────────────────────────────────────

/**
 * A level only makes sense on one side of the entry: a LONG's stop sits
 * below it and its target above (mirrored for SHORT). A row that says
 * otherwise is a typo or a half-filled form — the app cannot tell which way
 * price would have to move to "reach" it, so it watches neither.
 */
function levelIsCoherent(
  direction: "LONG" | "SHORT",
  entry: number,
  level: number,
  kind: "SL" | "TP",
): boolean {
  if (!(level > 0) || !(entry > 0)) return false;
  const below = level < entry;
  if (direction === "LONG") return kind === "SL" ? below : !below;
  return kind === "SL" ? !below : below;
}

function levelReached(
  direction: "LONG" | "SHORT",
  price: number,
  level: number,
  kind: "SL" | "TP",
): boolean {
  if (direction === "LONG") {
    // Stop sits below entry (price falls into it), target above (price rises).
    return kind === "SL" ? price <= level : price >= level;
  }
  return kind === "SL" ? price >= level : price <= level;
}

/** 61200 → "61,200"; 0.00001234 survives intact. */
const fmtLevel = (n: number): string =>
  n.toLocaleString("en-US", { maximumFractionDigits: 8 });

/** Binance pairs are written BTCUSDT; the journal may hold "BTC/USDT". */
const normalizeSymbol = (raw: string): string =>
  raw.toUpperCase().replace(/[\s/]/g, "");

/**
 * `[a,b,c]` rotated by 1 → `[b,c,a]`. Nothing is dropped, only the order
 * changes — that is the whole trick behind the caps being fair: whoever is
 * last in line this tick is nearer the front on the next.
 */
function rotate<T>(items: T[], by: number): T[] {
  if (items.length < 2) return items;
  const k = ((by % items.length) + items.length) % items.length;
  return k === 0 ? items : [...items.slice(k), ...items.slice(0, k)];
}

/** Public origin of the app; AUTH_URL is already required for login to work. */
function journalUrl(): string | null {
  const base = process.env.AUTH_URL?.replace(/\/+$/, "");
  return base ? `${base}/journal` : null;
}

// ──────────────────────────────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────────────────────────────

/**
 * Keys only, values forced to `true`. A malformed row (hand-edited JSON, an
 * array, a string) must degrade into "nothing latched yet" for that one user
 * instead of throwing inside the shared loop.
 */
function asWatchState(value: unknown): WatchState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const out: WatchState = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === true) out[k] = true;
  }
  return out;
}

async function getStates(userIds: string[]): Promise<Map<string, WatchState>> {
  const out = new Map<string, WatchState>();
  if (userIds.length === 0) return out;
  const rows = await db.appSetting.findMany({
    where: { key: STATE_KEY, userId: { in: userIds } },
    select: { userId: true, value: true },
  });
  for (const r of rows) out.set(r.userId, asWatchState(r.value));
  return out;
}

async function setState(userId: string, state: WatchState): Promise<void> {
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: STATE_KEY } },
    create: { userId, key: STATE_KEY, value: state },
    update: { value: state },
  });
}

/**
 * One query per user, each with its own cap, walked in this tick's rotated
 * order — see MAX_TRADES_PER_USER for why a shared LIMIT is not an option.
 *
 * `userIds` must already be rotated. A user MISSING from the returned map was
 * not read at all this tick: the caller must then leave their latch state
 * untouched, since "no trades found" and "not looked at" are the same shape
 * here but mean opposite things.
 */
async function fetchWatchedTrades(
  userIds: string[],
  cursor: number,
): Promise<{ work: Map<string, UserWork>; deferred: string[] }> {
  const work = new Map<string, UserWork>();
  const deferred: string[] = [];
  let rowBudget = MAX_TRADES;

  for (const userId of userIds) {
    // Only start a user we can still read in FULL: a half-read user looks
    // exactly like one who closed the trades we skipped, and their latches
    // would be rewritten from a partial picture.
    if (rowBudget < MAX_TRADES_PER_USER) {
      deferred.push(userId);
      continue;
    }

    // Whole read + decode inside the try: one user's unreadable row must cost
    // that user their tick, not everyone else theirs.
    try {
      const rows = await db.tradeJournal.findMany({
        where: {
          userId,
          status: "OPEN",
          market: "CRYPTO",
          OR: [{ stopLoss: { not: null } }, { takeProfit: { not: null } }],
        },
        select: {
          id: true,
          symbol: true,
          direction: true,
          entryPrice: true,
          stopLoss: true,
          takeProfit: true,
        },
        // Direction alternates per tick so a user holding more open trades
        // than the per-user cap still gets the OLDEST ones looked at, instead
        // of the newest N and nothing else for the life of the process.
        orderBy: { openedAt: cursor % 2 === 0 ? "desc" : "asc" },
        take: MAX_TRADES_PER_USER,
      });
      rowBudget -= rows.length;

      const trades: OpenTrade[] = [];
      for (const r of rows) {
        const entryPrice = Number(r.entryPrice.toString());
        if (!Number.isFinite(entryPrice)) continue;
        trades.push({
          id: r.id,
          symbol: normalizeSymbol(r.symbol),
          direction: r.direction,
          entryPrice,
          stopLoss: r.stopLoss !== null ? Number(r.stopLoss.toString()) : null,
          takeProfit:
            r.takeProfit !== null ? Number(r.takeProfit.toString()) : null,
        });
      }

      const truncated = rows.length >= MAX_TRADES_PER_USER;
      if (truncated) {
        console.warn(
          `[cron:level-watch] user=${userId} has ${MAX_TRADES_PER_USER}+ open trades with levels — only ${MAX_TRADES_PER_USER} read this tick`,
        );
      }
      work.set(userId, { trades, truncated });
    } catch (e) {
      console.error(`[cron:level-watch] user=${userId} trade lookup failed`, e);
    }
  }

  return { work, deferred };
}

/**
 * Hand out the tick's price budget ROUND-ROBIN — one symbol per user per
 * round — instead of first-come. Users arrive already rotated, and each
 * user's own list is rotated too, so a user watching more pairs than their
 * share of the budget cycles through them over successive ticks rather than
 * losing the same tail every time. Coverage can be delayed; it is never
 * denied.
 *
 * A pair several users hold costs ONE lookup and covers all of them, so the
 * budget stretches furthest exactly where the overlap is (BTC/ETH).
 */
function planPriceLookups(
  symbolsByUser: Map<string, string[]>,
  cursor: number,
): { symbols: string[]; deferredByUser: Map<string, number> } {
  const queues = [...symbolsByUser.values()].map((list) => rotate(list, cursor));
  const picked = new Set<string>();

  for (let depth = 0; picked.size < MAX_SYMBOLS; depth += 1) {
    let anyLeft = false;
    for (const queue of queues) {
      if (depth >= queue.length) continue;
      anyLeft = true;
      picked.add(queue[depth]);
      if (picked.size >= MAX_SYMBOLS) break;
    }
    if (!anyLeft) break;
  }

  const deferredByUser = new Map<string, number>();
  for (const [userId, list] of symbolsByUser) {
    const missed = list.filter((s) => !picked.has(s)).length;
    if (missed > 0) deferredByUser.set(userId, missed);
  }
  return { symbols: [...picked], deferredByUser };
}

/** One lookup per distinct symbol for the whole tick, across all users. */
async function priceBySymbol(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const now = Date.now();
  // Sequential on purpose: no user is waiting on a cron, and bursting the
  // quote path would only queue behind the egress guard's pacer anyway.
  for (const symbol of symbols) {
    const skipUntil = unpriceableUntil.get(symbol);
    if (skipUntil !== undefined) {
      if (skipUntil > now) continue;
      unpriceableUntil.delete(symbol);
    }
    try {
      const quote = await getPrice("CRYPTO", symbol);
      if (Number.isFinite(quote.price) && quote.price > 0) {
        out.set(symbol, quote.price);
      }
    } catch (e) {
      // 400 = Binance does not list this pair. Anything else (rate limit,
      // network, open breaker) is transient and must NOT poison the symbol.
      if (e instanceof BinanceError && e.status === 400) {
        unpriceableUntil.set(symbol, now + UNPRICEABLE_TTL_MS);
      }
    }
  }
  return out;
}

/** Key-set comparison — the values are always `true`. */
function sameKeys(a: WatchState, b: WatchState): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b);
}

// ──────────────────────────────────────────────────────────────────────
// Tick
// ──────────────────────────────────────────────────────────────────────

export async function runLevelWatchForAllUsers(): Promise<void> {
  if (!telegramEnabled()) return;

  const cursor = tickCursor++;

  let optedIn: string[] = [];
  try {
    const rows = await db.user.findMany({
      where: { telegramChatId: { not: null } },
      select: { id: true },
    });
    const userIds = rows.map((r) => r.id);
    if (userIds.length === 0) return;
    const prefs = await getPersonalDmPrefsMap(userIds);
    optedIn = userIds.filter((id) => prefs.get(id)?.levelWatch === true);
  } catch (e) {
    console.error("[cron:level-watch] user lookup failed", e);
    return;
  }
  if (optedIn.length === 0) return;

  // Sorted first so the rotation has a stable base to turn: the DB's row
  // order is not guaranteed, and a queue that reshuffles itself cannot
  // promise anyone their turn.
  const order = rotate([...optedIn].sort(), cursor);

  let work = new Map<string, UserWork>();
  let deferred: string[] = [];
  let states = new Map<string, WatchState>();
  try {
    const [fetched, st] = await Promise.all([
      fetchWatchedTrades(order, cursor),
      getStates(optedIn),
    ]);
    work = fetched.work;
    deferred = fetched.deferred;
    states = st;
  } catch (e) {
    console.error("[cron:level-watch] trade lookup failed", e);
    return;
  }

  // Dropped work is always said out loud: a silent truncation reads like
  // "everything was checked" to whoever is looking at the logs.
  if (deferred.length > 0) {
    console.warn(
      `[cron:level-watch] row budget ${MAX_TRADES} spent — ${deferred.length} user(s) not read this tick, first in line on the next: ${deferred.slice(0, 10).join(", ")}${deferred.length > 10 ? " …" : ""}`,
    );
  }

  // Symbols already known to be unlisted are dropped BEFORE the budget is
  // split: a junk pair free-typed into one journal must not eat a slot that
  // a real position needs.
  const now = Date.now();
  const symbolsByUser = new Map<string, string[]>();
  for (const [userId, w] of work) {
    const own = [
      ...new Set(
        w.trades
          .map((t) => t.symbol)
          .filter((s) => (unpriceableUntil.get(s) ?? 0) <= now),
      ),
    ];
    if (own.length > 0) symbolsByUser.set(userId, own);
  }

  const { symbols, deferredByUser } = planPriceLookups(symbolsByUser, cursor);
  if (deferredByUser.size > 0) {
    const total = [...deferredByUser.values()].reduce((a, b) => a + b, 0);
    console.warn(
      `[cron:level-watch] price budget ${MAX_SYMBOLS} spent — ${total} symbol(s) across ${deferredByUser.size} user(s) not priced this tick; they lead the rotation next tick`,
    );
  }
  const prices = await priceBySymbol(symbols);

  // Only users actually read this tick. A user the budget skipped keeps their
  // latch state exactly as it was — rewriting it from an empty read would
  // clear every latch and re-send alerts they already got.
  for (const [userId, w] of work) {
    const own = w.trades;
    const prev = states.get(userId) ?? {};
    if (own.length === 0 && Object.keys(prev).length === 0) continue;

    try {
      // Rebuilt from scratch each tick, so keys belonging to trades that are
      // no longer open drop out instead of accumulating forever.
      const next: WatchState = {};
      const hits: Hit[] = [];

      // Partial read: latches for the trades we did NOT see must be carried
      // over, or that trade would alert a second time when it rotates back
      // into view. Only for a truncated read — on a full read a missing key
      // genuinely means the trade is no longer open.
      if (w.truncated) {
        const seen = new Set(own.map((t) => t.id));
        for (const key of Object.keys(prev)) {
          if (!seen.has(key.slice(0, key.indexOf(":")))) next[key] = true;
        }
      }

      for (const t of own) {
        const price = prices.get(t.symbol);
        for (const [kind, level] of [
          ["SL", t.stopLoss],
          ["TP", t.takeProfit],
        ] as const) {
          if (level === null || !Number.isFinite(level)) continue;
          if (!levelIsCoherent(t.direction, t.entryPrice, level, kind)) continue;
          const key = `${t.id}:${kind}@${level}`;
          // Latched, not re-armed on the way back: price wobbling across a
          // stop would otherwise DM the user again every few minutes about
          // the same event. The latch clears when the trade stops being OPEN
          // (the key is no longer rebuilt) — and because the key carries the
          // level, moving the stop re-arms it on the new number.
          if (prev[key]) {
            next[key] = true;
            continue;
          }
          // No price this tick (unlisted pair, open breaker): nothing to
          // compare against, so simply don't decide yet.
          if (price === undefined) continue;
          if (!levelReached(t.direction, price, level, kind)) continue;
          next[key] = true;
          hits.push({
            key,
            symbol: t.symbol,
            direction: t.direction,
            kind,
            level,
          });
        }
      }

      if (hits.length > 0) {
        const url = journalUrl();
        const ok = await notifyUser(
          userId,
          [
            "🔔 Giá chạm mức bạn đã ghi",
            "",
            hits
              .map(
                (h) =>
                  `• ${h.symbol} ${h.direction} — giá vừa chạm ${h.kind} của bạn (${fmtLevel(h.level)})`,
              )
              .join("\n"),
            "",
            url
              ? `Nếu đã đóng, vào cập nhật P/L: ${url}`
              : "Nếu đã đóng, vào cập nhật P/L trong app → Nhật ký.",
            "Tắt tin này: Cài đặt → Thông báo Telegram.",
          ].join("\n"),
        );
        // Send failed: leave those keys unset so the next tick retries,
        // instead of silently swallowing the only alert for this level.
        // Bounded in practice — the retry ends when the trade stops being
        // OPEN or the user unlinks Telegram.
        if (!ok) {
          for (const h of hits) delete next[h.key];
        }
      }

      // Only write when something actually changed — this ticks all day.
      if (!sameKeys(next, prev)) await setState(userId, next);
    } catch (e) {
      console.error(`[cron:level-watch] user=${userId} failed`, e);
    }
  }
}
