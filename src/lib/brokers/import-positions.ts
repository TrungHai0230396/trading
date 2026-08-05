/**
 * Read-only import of OPEN positions from every connected exchange into the
 * user's trading journal, plus reconciliation of the ones that are gone.
 *
 * For each connected broker (Bitget / Binance / MEXC / OKX) we read the live
 * open positions (getOpenPositions — a pure READ) and upsert one journal entry
 * per position, keyed by `brokerRef = "<BROKER>:<SYMBOL>:<SIDE>"`. Re-syncing
 * UPDATES the same entry (refreshes entry price + size) instead of creating a
 * duplicate; the user's own notes/setup/SL/TP/strategy are never touched.
 *
 * That key carries no trade identity, so it can only ever point at the trade
 * currently live on the pair. As soon as a row stops being OPEN — reconciled
 * below or closed by hand in the journal — re-entering the same pair must NOT
 * reuse it: the finished trade keeps every figure it was stamped with and its
 * ref is retired to "<BROKER>:<SYMBOL>:<SIDE>#<rowId>", and the new position
 * gets a row of its own. Reusing it would badge the previous trade's PnL and
 * exit price onto a live position whose outcome nobody can know yet, and drop
 * the finished trade out of win-rate, equity curve and every report.
 *
 * That read returns the COMPLETE set of open positions for the broker, so the
 * same response also tells us what CLOSED: any journal row we imported for
 * this broker that is missing from the response is no longer open on the
 * exchange. Without this the journal could only ever grow open rows — the
 * dashboard would claim 12 open trades against 2 real ones, and win-rate and
 * the equity curve would never see a finished trade.
 *
 * Money rules for a reconciled close:
 *   - Bitget/Binance can report the real exit price, realized PnL and fees →
 *     write them, and derive rMultiple only when a risk figure exists.
 *   - MEXC/OKX (no usable close history here) → mark the row CLOSED and add a
 *     note telling the user to type the real exit; NEVER invent a price or a
 *     PnL the app cannot know.
 *
 * Never writes to any exchange. One broker failing (e.g. a spot-only MEXC key
 * with no Futures permission) degrades to a per-broker error; the others still
 * import — and a broker whose read FAILED is never reconciled, because "the
 * request errored" must never be mistaken for "the position closed".
 */

import "server-only";
import { db } from "@/lib/db";
import { loadCreds } from "@/lib/brokers/store";
import { deriveRMultiple } from "@/lib/journal/derive";
import {
  getOpenPositions as bitgetOpenPositions,
  getPositionHistory as bitgetPositionHistory,
  BitgetError,
  type BitgetCreds,
  type BitgetPosition,
} from "@/lib/brokers/bitget";
import {
  getOpenPositions as binanceOpenPositions,
  getCloseSummary as binanceCloseSummary,
  CLOSE_HISTORY_WINDOW_MS,
  BinanceError,
  type BinanceCreds,
} from "@/lib/brokers/binance";
import {
  getOpenPositions as mexcOpenPositions,
  MexcError,
  type MexcCreds,
} from "@/lib/brokers/mexc";
import {
  getOpenPositions as okxOpenPositions,
  OkxError,
  type OkxCreds,
} from "@/lib/brokers/okx";

type BrokerName = "BITGET" | "BINANCE" | "MEXC" | "OKX";

export const BROKER_LABEL: Record<BrokerName, string> = {
  BITGET: "Bitget",
  BINANCE: "Binance",
  MEXC: "MEXC",
  OKX: "OKX",
};

/** Position closed on the exchange and reconciled into the journal. */
export type BrokerClosure = {
  broker: BrokerName;
  symbol: string;
  direction: "LONG" | "SHORT";
  /** null = the exchange could not tell us; the user types the real figure. */
  pnl: number | null;
  rMultiple: number | null;
};

export type ImportResult = {
  created: number;
  updated: number;
  /** Rows closed because the position is gone from the exchange. */
  closed: number;
  closures: BrokerClosure[];
  byBroker: Array<{
    broker: BrokerName;
    open: number;
    closed: number;
    error?: string;
  }>;
};

/** Clock skew between us and the exchange, and the gap between "last seen
 *  open" and the closing fill, are both small — but not zero. */
const HISTORY_BUFFER_MS = 30 * 60_000;

/** Closures reconciled per broker per run. The first sync after a long gap
 *  finds a backlog; draining it across runs keeps one user's catch-up from
 *  bursting an exchange rate limit that every other user shares. */
const MAX_CLOSE_PER_RUN = 10;

/** A history endpoint that keeps failing must not pin a row OPEN forever —
 *  stale OPEN rows are the very bug this reconciliation exists to fix. Past
 *  this age we close the row with no money figures and let the user fill them. */
const STALE_FORCE_CLOSE_MS = 60 * 60_000;

/** Fill quantities and the size we last saw open come from different endpoints
 *  at different moments, so they never match to the last decimal. 1% either way
 *  absorbs that (and a scale-out rounding) without letting a whole extra
 *  round-trip through. */
const CLOSE_QTY_TOLERANCE = 0.01;

const NEEDS_EXIT_AND_PNL_NOTE =
  "Đã đóng trên sàn — nhập giá thoát và lãi/lỗ thật từ sàn.";
const NEEDS_EXIT_NOTE = "Đã đóng trên sàn — nhập giá thoát.";

/** What the exchange actually reports about a position that is no longer open. */
type CloseFacts = {
  /** null when the exchange gave a PnL but no usable average close price. */
  exitPrice: number | null;
  pnl: number;
  fees: number;
  closedAt: Date;
};

/**
 * Ask the exchange what happened to a position that vanished from the open
 * set. `null` means "no record" — the caller then closes the row WITHOUT
 * money figures rather than guessing. Throwing means the read failed and the
 * caller should try again later.
 */
type CloseLookup = (row: {
  symbol: string;
  side: "long" | "short";
  /** Size we last saw open — used to check the close is fully accounted for. */
  size: number;
  /** When we last saw this position open on the exchange. */
  lastSeenAt: Date;
}) => Promise<CloseFacts | null>;

/** Prisma unique-constraint violation (duck-typed to avoid importing the
 *  generated error class). */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}

function errText(broker: BrokerName, e: unknown): string {
  if (
    e instanceof BitgetError ||
    e instanceof BinanceError ||
    e instanceof MexcError ||
    e instanceof OkxError
  ) {
    return e.toVietnamese();
  }
  if (e instanceof Error && e.name === "TimeoutError") {
    return `${BROKER_LABEL[broker]} không phản hồi kịp.`;
  }
  return e instanceof Error ? e.message : "Lỗi không xác định";
}

function appendNote(existing: string | null, line: string): string {
  const base = (existing ?? "").trimEnd();
  return base ? `${base}\n${line}` : line;
}

// ──────────────────────────────────────────────────────────────────────
// Close lookups — one per broker that can tell us the truth
// ──────────────────────────────────────────────────────────────────────

const bitgetClose =
  (creds: BitgetCreds): CloseLookup =>
  async ({ symbol, side, lastSeenAt }) => {
    const since = new Date(lastSeenAt.getTime() - HISTORY_BUFFER_MS);
    const history = await bitgetPositionHistory(creds, {
      symbol,
      startTime: since,
      limit: 20,
    });
    // Bitget writes one row per position lifecycle (open → flat) with the
    // cycle's own netProfit, so the most recent close on this symbol+side
    // after we last saw the position open IS the close we just detected.
    let best: (typeof history)[number] | null = null;
    for (const h of history) {
      if (h.symbol !== symbol || h.holdSide !== side) continue;
      if (h.closedAt.getTime() < since.getTime()) continue;
      // A position we watched being open cannot have been OPENED after we
      // last saw it. Without this, a row left stale for months could adopt
      // the PnL of a completely different trade on the same pair.
      if (h.openedAt.getTime() > lastSeenAt.getTime() + HISTORY_BUFFER_MS) {
        continue;
      }
      if (!best || h.closedAt.getTime() > best.closedAt.getTime()) best = h;
    }
    if (!best || !Number.isFinite(best.netProfit)) return null;
    return {
      exitPrice: best.closeAvgPrice > 0 ? best.closeAvgPrice : null,
      pnl: best.netProfit,
      fees: best.totalFee + Math.abs(best.totalFunding),
      closedAt: best.closedAt,
    };
  };

const binanceClose =
  (creds: BinanceCreds): CloseLookup =>
  async ({ symbol, side, size, lastSeenAt }) => {
    const since = new Date(lastSeenAt.getTime() - HISTORY_BUFFER_MS);
    // fapi keeps no closed-position record: the figures are summed from raw
    // fills, and only the last 7 days of them are readable. If we last saw
    // the position open before that, fills found now could just as easily
    // belong to a LATER trade on the same pair, and nothing tells them apart.
    if (since.getTime() < Date.now() - CLOSE_HISTORY_WINDOW_MS) return null;
    const s = await binanceCloseSummary(creds, symbol, since, side);
    if (!s || !Number.isFinite(s.netProfit)) return null;
    // Same reason, one step finer. The size we last saw open is the only
    // trustworthy anchor for how much SHOULD have closed, so the check has to
    // run both ways:
    //   - fills adding up to LESS → part of the close is missing and every
    //     number below would understate the trade;
    //   - fills adding up to MORE → the window swallowed a whole extra
    //     round-trip (closed, re-entered and closed again between two syncs)
    //     and the sum belongs to neither trade: +40 then −70 would be stamped
    //     as −30, with a qty-weighted exit price that was never traded.
    // Reconstructing the last cycle from the fills is not an option either —
    // userTrades carries no side/buyer field to sign the quantities, the window
    // opens mid-position so there is no flat anchor, and the row's entryPrice
    // came from the FIRST cycle anyway. Say nothing rather than post a wrong
    // number: the row falls through to the "nhập giá thoát" path, exactly as
    // MEXC/OKX rows already do.
    if (!(size > 0)) return null;
    if (s.closedQty < size * (1 - CLOSE_QTY_TOLERANCE)) return null;
    if (s.closedQty > size * (1 + CLOSE_QTY_TOLERANCE)) return null;
    return {
      exitPrice: s.exitPrice,
      pnl: s.netProfit,
      fees: s.totalFee + Math.abs(s.totalFunding),
      closedAt: s.lastFillAt ?? new Date(),
    };
  };

// ──────────────────────────────────────────────────────────────────────
// Reconciliation
// ──────────────────────────────────────────────────────────────────────

/**
 * Close the journal rows this broker no longer holds open. Only ever called
 * with a `positions` list that came back from a SUCCESSFUL read — a failed
 * or partial read must never reach here, or a network blip would close a
 * user's live trades in their journal.
 */
async function reconcileClosed(
  userId: string,
  broker: BrokerName,
  positions: BitgetPosition[],
  snapshotAt: Date,
  lookup: CloseLookup | null,
  closures: BrokerClosure[],
): Promise<number> {
  // Built from EVERY row the exchange returned, including the ones the upsert
  // loop skipped as unwritable (size/entry price 0): those are still open, and
  // treating a skipped row as closed would take a live trade off the journal.
  const live = new Set(positions.map((p) => `${broker}:${p.symbol}:${p.side}`));

  const rows = await db.tradeJournal.findMany({
    where: {
      userId,
      // Only rows this importer created carry source=BROKER + brokerRef, so
      // hand-written and order-flow trades can never be touched from here.
      source: "BROKER",
      status: "OPEN",
      // A retired ref ("…:long#<rowId>", see the upsert loop) still starts with
      // the broker prefix, but it belongs to a finished trade and tracks
      // nothing on the exchange any more — it can never appear in `live`. Only
      // a non-OPEN row gets retired, so status alone covers the normal case;
      // this keeps a row the user re-opens by hand from being "closed" a second
      // time here, with a second Telegram notice and a double-counted close.
      brokerRef: { startsWith: `${broker}:`, not: { contains: "#" } },
      // A row refreshed AFTER we took our snapshot was seen open by a newer,
      // overlapping sync (page poll + manual click + cron can interleave).
      // Our list is already stale for it, so leave it alone.
      updatedAt: { lt: snapshotAt },
    },
    select: {
      id: true,
      brokerRef: true,
      symbol: true,
      direction: true,
      entryPrice: true,
      stopLoss: true,
      lotSize: true,
      riskAmount: true,
      notes: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "asc" }, // stalest first
    take: 200,
  });

  const gone = rows.filter(
    (r) => r.brokerRef !== null && !live.has(r.brokerRef),
  );

  let closed = 0;
  for (const row of gone.slice(0, MAX_CLOSE_PER_RUN)) {
    const side: "long" | "short" = row.direction === "LONG" ? "long" : "short";
    const size = Number(row.lotSize);
    const lastSeenAt = row.updatedAt;

    let facts: CloseFacts | null = null;
    if (lookup) {
      try {
        facts = await lookup({ symbol: row.symbol, side, size, lastSeenAt });
      } catch {
        // The POSITION read succeeded, so the position really is gone; only
        // the history read failed. Retry on the next sync instead of throwing
        // away the real exit price — unless the row has sat stale so long
        // that leaving it OPEN is the bigger lie.
        if (Date.now() - lastSeenAt.getTime() < STALE_FORCE_CLOSE_MS) continue;
      }
    }
    // Last gate before a money column: a NaN reaching Prisma would throw and
    // take the rest of this broker's reconciliation down with it. Treat an
    // unusable answer as no answer — the user gets the "nhập giá thoát" note.
    if (facts && !(Number.isFinite(facts.pnl) && Number.isFinite(facts.fees))) {
      facts = null;
    }

    const data: {
      status: "CLOSED";
      closedAt: Date;
      exitPrice?: number;
      pnl?: number;
      feesAmount?: number;
      rMultiple?: number;
      riskAmount?: number;
      notes?: string;
    } = { status: "CLOSED", closedAt: facts?.closedAt ?? new Date() };

    let rMultiple: number | null = null;
    if (facts) {
      const exitPrice =
        facts.exitPrice !== null && facts.exitPrice > 0 ? facts.exitPrice : null;
      if (exitPrice !== null) data.exitPrice = exitPrice;
      data.pnl = facts.pnl;
      data.feesAmount = facts.fees;
      // Risk is the user's own figure when they set one, else the distance to
      // the stop THEY recorded × size. With neither, there is no risk to
      // divide by and rMultiple stays empty — R is never invented.
      const existingRisk =
        row.riskAmount !== null ? Number(row.riskAmount) : 0;
      const entry = Number(row.entryPrice);
      const sl = row.stopLoss !== null ? Number(row.stopLoss) : null;
      // A stop only measures RISK while it sits on the losing side of entry:
      // below for a LONG, above for a SHORT. Once the user trails it past entry
      // to lock profit, |entry − stop| is guaranteed GAIN, not risk, and
      // dividing by it prints an R that means nothing. Leave R empty instead.
      const derivedRisk =
        sl !== null &&
        Number.isFinite(entry) &&
        Number.isFinite(size) &&
        (side === "long" ? sl < entry : sl > entry)
          ? Math.abs(entry - sl) * size
          : 0;
      const riskAmount = existingRisk > 0 ? existingRisk : derivedRisk;
      if (riskAmount > 0) {
        rMultiple = deriveRMultiple(facts.pnl, riskAmount);
        if (rMultiple !== null) data.rMultiple = rMultiple;
        // Persist the derived risk so the R shown stays reproducible.
        if (existingRisk <= 0) data.riskAmount = derivedRisk;
      }
      if (exitPrice === null) {
        data.notes = appendNote(row.notes, NEEDS_EXIT_NOTE);
      }
    } else {
      // MEXC/OKX, or an exchange with no record of the close. The journal UI
      // already renders "—" for an empty exit/PnL and the note tells the user
      // what to do; a made-up price would corrupt their equity curve.
      data.notes = appendNote(row.notes, NEEDS_EXIT_AND_PNL_NOTE);
    }

    // status: "OPEN" in the filter makes the write idempotent: if an
    // overlapping sync closed this row first, count is 0 and we skip it
    // instead of double-reporting the close.
    const res = await db.tradeJournal.updateMany({
      where: { id: row.id, status: "OPEN" },
      data,
    });
    if (res.count === 0) continue;

    closed += 1;
    closures.push({
      broker,
      symbol: row.symbol,
      direction: row.direction,
      pnl: facts ? facts.pnl : null,
      rMultiple,
    });
  }

  return closed;
}

export async function importOpenPositions(userId: string): Promise<ImportResult> {
  const [bitget, binance, mexc, okx] = await Promise.all([
    loadCreds<BitgetCreds>(userId, "BITGET"),
    loadCreds<BinanceCreds>(userId, "BINANCE"),
    loadCreds<MexcCreds>(userId, "MEXC"),
    loadCreds<OkxCreds>(userId, "OKX"),
  ]);

  const byBroker: ImportResult["byBroker"] = [];
  const closures: BrokerClosure[] = [];
  let created = 0;
  let updated = 0;
  let closed = 0;

  const runOne = async (
    broker: BrokerName,
    fetcher: () => Promise<BitgetPosition[]>,
    lookup: CloseLookup | null,
  ): Promise<void> => {
    // Taken BEFORE the read so any row a concurrent sync refreshes while we
    // are in flight is excluded from reconciliation.
    const snapshotAt = new Date();
    let positions: BitgetPosition[];
    try {
      positions = await fetcher();
    } catch (e) {
      // Read failed → we know nothing about this broker's positions. Report
      // the error and return WITHOUT reconciling: a timeout or a rate limit
      // must never be read as "every position closed".
      byBroker.push({ broker, open: 0, closed: 0, error: errText(broker, e) });
      return;
    }
    let writeError: string | undefined;
    for (const p of positions) {
      // getOpenPositions already filters size≠0; guard the price too so a
      // bad row can never write a nonsense entryPrice into the journal.
      if (!(p.size > 0) || !(p.entryPrice > 0)) continue;
      const direction: "LONG" | "SHORT" = p.side === "long" ? "LONG" : "SHORT";
      const brokerRef = `${broker}:${p.symbol}:${p.side}`;
      // Refresh the objective facts only — never the user's notes/setup/SL/TP.
      const updateData = {
        entryPrice: p.entryPrice,
        lotSize: p.size,
        direction,
        status: "OPEN" as const,
      };
      const createData = {
        userId,
        symbol: p.symbol,
        market: "CRYPTO" as const,
        openedAt: new Date(),
        source: "BROKER",
        brokerRef,
        notes: `Nhập tự động từ ${BROKER_LABEL[broker]} · đòn bẩy ${
          p.leverage || "?"
        }x (chỉ đọc — cập nhật khi bấm Đồng bộ sàn).`,
        ...updateData,
      };
      // Both create paths race the same way: a concurrent sync (auto-on-mount +
      // poll + manual click can overlap) may have taken the ref first → unique
      // violation. Refresh whichever row holds the ref now, but ONLY while that
      // row is OPEN: writing into a closed one is the exact resurrection this
      // loop exists to prevent, so if the winner is already closed we leave it
      // and let the next sync retire the ref properly.
      const refreshRefHolder = async (e: unknown): Promise<void> => {
        if (!isUniqueViolation(e)) throw e;
        const res = await db.tradeJournal.updateMany({
          where: { userId, brokerRef, status: "OPEN" },
          data: updateData,
        });
        if (res.count > 0) updated += 1;
      };

      try {
        const existing = await db.tradeJournal.findUnique({
          where: { userId_brokerRef: { userId, brokerRef } },
          select: { id: true, status: true, updatedAt: true },
        });

        if (existing && existing.status !== "OPEN") {
          // The row holding this ref is a FINISHED trade (reconciled here, or
          // closed by hand in the journal) and the exchange is showing the pair
          // open again — a re-entry, not the same trade. Retire the ref so the
          // finished trade keeps its PnL/exit/closedAt, and give the new
          // position its own row.
          if (existing.updatedAt.getTime() >= snapshotAt.getTime()) {
            // …unless it was closed AFTER we read positions: our list predates
            // the close, so this "open" position is most likely already flat.
            // Minting a row for it would have the next run reconcile it against
            // the very same fills and count that PnL twice. Skip; the next sync
            // reads a list that reflects reality.
            continue;
          }
          try {
            // Rename + create must be one unit: a crash in between would leave
            // the finished trade holding the ref with no live row, and the next
            // sync would overwrite it after all. The suffix is the row ID —
            // two closes landing in the same millisecond would collide on a
            // closedAt-based suffix and throw P2002.
            await db.$transaction(async (tx) => {
              await tx.tradeJournal.updateMany({
                // Guarded so a ref already retired (or a row the user re-opened
                // meanwhile) is left alone; the create below then collides and
                // falls through to the refresh path.
                where: { id: existing.id, brokerRef, status: { not: "OPEN" } },
                data: { brokerRef: `${brokerRef}#${existing.id}` },
              });
              await tx.tradeJournal.create({ data: createData });
            });
            created += 1;
          } catch (e) {
            await refreshRefHolder(e);
          }
        } else if (existing) {
          await db.tradeJournal.update({ where: { id: existing.id }, data: updateData });
          updated += 1;
        } else {
          try {
            await db.tradeJournal.create({ data: createData });
            created += 1;
          } catch (e) {
            await refreshRefHolder(e);
          }
        }
      } catch (e) {
        // One row's write failing must not abort the rest, nor the other
        // brokers' imports. Record it against this broker and keep going.
        if (!writeError) writeError = errText(broker, e);
      }
    }

    let closedHere = 0;
    try {
      closedHere = await reconcileClosed(
        userId,
        broker,
        positions,
        snapshotAt,
        lookup,
        closures,
      );
      closed += closedHere;
      // A closed row IS an updated row: the journal page only refetches when
      // created+updated > 0, and a sync that ONLY closed positions would
      // otherwise leave the user staring at a list that still says "đang mở".
      updated += closedHere;
    } catch (e) {
      if (!writeError) writeError = errText(broker, e);
    }
    byBroker.push({
      broker,
      open: positions.length,
      closed: closedHere,
      error: writeError,
    });
  };

  const jobs: Promise<void>[] = [];
  if (bitget) {
    jobs.push(
      runOne("BITGET", () => bitgetOpenPositions(bitget), bitgetClose(bitget)),
    );
  }
  if (binance) {
    jobs.push(
      runOne(
        "BINANCE",
        () => binanceOpenPositions(binance),
        binanceClose(binance),
      ),
    );
  }
  // MEXC and OKX: positions only. Neither close-history path is wired here,
  // so their rows close with a "nhập giá thoát" note instead of a made-up fill.
  if (mexc) jobs.push(runOne("MEXC", () => mexcOpenPositions(mexc), null));
  if (okx) jobs.push(runOne("OKX", () => okxOpenPositions(okx), null));
  await Promise.all(jobs);

  return { created, updated, closed, closures, byBroker };
}
