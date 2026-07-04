/**
 * Read-only sync from Bitget back to our journal.
 *
 * Hard rule: this module NEVER writes to Bitget. It only READS state
 * (order detail, position history) and updates our own DB. That keeps
 * the safety guarantee: a sync run can never cancel, modify or close a
 * real position. Worst case is wrong PnL data in the journal — fixable.
 *
 * What it does per BrokerOrder row:
 *
 *   PENDING / PLACED / PLACED_NO_SL
 *     → call getOrderDetail
 *     → state="filled"     → BrokerOrder=FILLED, journal.entryPrice ← priceAvg
 *     → state="canceled"   → BrokerOrder=CANCELLED, journal.status=CANCELED
 *     → state="live"|"new" → no change
 *     → 40768 (not found)  → BrokerOrder=UNKNOWN
 *
 *   FILLED with journal.status=OPEN
 *     → query getPositionHistory(symbol, openedAt..now)
 *     → if a closed position matches symbol+holdSide+timing
 *         → journal.status=CLOSED
 *         → journal.exitPrice=closeAvgPrice
 *         → journal.pnl=netProfit (Bitget's realized PnL incl. fees)
 *         → journal.closedAt=Bitget closedAt
 *
 * Returns a summary so the caller can toast the user "Đã đồng bộ N lệnh".
 */

import "server-only";
import { db } from "@/lib/db";
import { loadCreds } from "@/lib/brokers/store";
import {
  getOrderDetail,
  getPositionHistory,
  BitgetError,
  type BitgetCreds,
} from "@/lib/brokers/bitget";

type BrokerOrderRow = Awaited<
  ReturnType<typeof db.brokerOrder.findFirst>
>;

export type SyncChange = {
  brokerOrderId: string;
  tradeJournalId: string;
  before: string;
  after: string;
  note?: string;
};

export type SyncResult = {
  scanned: number;
  changes: SyncChange[];
  errors: Array<{ brokerOrderId: string; message: string }>;
};

/**
 * Sync one BrokerOrder row. Returns changes (if any). Best-effort: any
 * Bitget error is caught and reported in `result.errors` but does NOT
 * fail the overall run — other rows still get a chance.
 */
async function syncOne(
  creds: BitgetCreds,
  row: NonNullable<BrokerOrderRow>,
): Promise<{ change: SyncChange | null; error: string | null }> {
  // Phase 1: BrokerOrder state machine (PENDING/PLACED/UNKNOWN → FILLED /
  // CANCELLED). UNKNOWN is included so an order whose placement response was
  // lost (network/timeout, see order route) gets reconciled by clientOid
  // instead of being abandoned — the order may actually be live on Bitget.
  if (
    row.status === "PENDING" ||
    row.status === "PLACED" ||
    row.status === "PLACED_NO_SL" ||
    row.status === "UNKNOWN"
  ) {
    try {
      const detail = await getOrderDetail(creds, {
        symbol: row.symbol,
        // clientOid is the reliable key for UNKNOWN rows (they may have no
        // externalOrderId because the place response never arrived).
        orderId: row.externalOrderId ?? undefined,
        clientOid: row.clientOid,
      });
      if (!detail) {
        // Order not found by orderId/clientOid. For an UNKNOWN row this
        // means the placement almost certainly never landed → leave it
        // UNKNOWN, no change (idempotent, stops the poll churn). For a
        // previously-PLACED row it likely aged out after fill+close → mark
        // UNKNOWN once so phase 2 stops chasing it.
        if (row.status === "UNKNOWN") {
          return { change: null, error: null };
        }
        await db.brokerOrder.update({
          where: { id: row.id },
          data: { status: "UNKNOWN" },
        });
        return {
          change: {
            brokerOrderId: row.id,
            tradeJournalId: row.tradeJournalId,
            before: row.status,
            after: "UNKNOWN",
            note: "Bitget không tìm thấy lệnh",
          },
          error: null,
        };
      }

      const state = detail.status.toLowerCase();
      // partially_filled ALSO means a real position is open — advance to
      // FILLED so phase-2 close detection covers it. (The order may still
      // fill more later; that only increases size, doesn't change that a
      // position exists.)
      if (state === "filled" || state === "partially_filled") {
        const updates: Record<string, unknown> = { status: "FILLED" };
        // Backfill externalOrderId for rows that lost it (UNKNOWN recovery).
        if (!row.externalOrderId && detail.orderId) {
          updates.externalOrderId = detail.orderId;
        }
        await db.brokerOrder.update({
          where: { id: row.id },
          data: updates,
        });
        // Also update the journal's entryPrice to actual fill if it differs
        // significantly (>0.1%) — keeps the recorded entry honest.
        if (detail.priceAvg) {
          const planned = Number(row.requestedPrice ?? row.price ?? 0);
          if (
            planned > 0 &&
            Math.abs(detail.priceAvg - planned) / planned > 0.001
          ) {
            await db.tradeJournal.update({
              where: { id: row.tradeJournalId },
              data: { entryPrice: detail.priceAvg },
            });
          }
        }
        return {
          change: {
            brokerOrderId: row.id,
            tradeJournalId: row.tradeJournalId,
            before: row.status,
            after: "FILLED",
            note: detail.priceAvg
              ? `Khớp tại ${detail.priceAvg}`
              : undefined,
          },
          error: null,
        };
      }

      if (
        state === "canceled" ||
        state === "cancelled" ||
        state === "expired"
      ) {
        await db.brokerOrder.update({
          where: { id: row.id },
          data: { status: "CANCELLED" },
        });
        await db.tradeJournal.updateMany({
          where: { id: row.tradeJournalId, status: "OPEN" },
          data: { status: "CANCELED" },
        });
        return {
          change: {
            brokerOrderId: row.id,
            tradeJournalId: row.tradeJournalId,
            before: row.status,
            after: "CANCELLED",
            note: "Lệnh đã huỷ trên Bitget",
          },
          error: null,
        };
      }

      // live / new / partially_filled → still active, do nothing.
      return { change: null, error: null };
    } catch (e) {
      return {
        change: null,
        error:
          e instanceof BitgetError
            ? e.toVietnamese()
            : e instanceof Error
              ? e.message
              : "Lỗi không xác định",
      };
    }
  }

  // Phase 2: position closure detection.
  // The BrokerOrder filled (so user opened a position). Check if that
  // position is still open by querying history-position.
  if (row.status === "FILLED") {
    const journal = await db.tradeJournal.findUnique({
      where: { id: row.tradeJournalId },
      select: { status: true, symbol: true, direction: true },
    });
    if (!journal || journal.status !== "OPEN") {
      return { change: null, error: null };
    }
    try {
      // Look back from the BrokerOrder createdAt with a 30-minute buffer.
      const since = new Date(row.createdAt.getTime() - 30 * 60_000);
      const history = await getPositionHistory(creds, {
        symbol: row.symbol,
        startTime: since,
      });
      const wantSide: "long" | "short" =
        row.side === "buy" ? "long" : "short";

      // Disambiguation matters: if the user opened the same symbol+side more
      // than once, several closed positions can fall in the window. Matching
      // only on symbol+side+time would grab the wrong one (and write another
      // trade's PnL onto this journal). So we:
      //   1. keep only closes on the correct symbol+side that closed at or
      //      after this order was created,
      //   2. require the position's OPEN price to be close (≤2%) to what we
      //      actually placed — that ties the close to THIS entry,
      //   3. among those, pick the one whose openedAt is nearest this order's
      //      createdAt.
      // If nothing matches on price, we do NOT guess — better to leave the
      // journal OPEN than to stamp it with a foreign PnL.
      const expectedEntry = Number(row.requestedPrice ?? row.price ?? 0);
      const candidates = history
        .filter(
          (h) =>
            h.symbol === row.symbol &&
            h.holdSide === wantSide &&
            h.closedAt.getTime() >= row.createdAt.getTime(),
        )
        .filter((h) => {
          if (!(expectedEntry > 0) || !(h.openAvgPrice > 0)) return true;
          return (
            Math.abs(h.openAvgPrice - expectedEntry) / expectedEntry <= 0.02
          );
        });

      let match = null as (typeof history)[number] | null;
      const orderTs = row.createdAt.getTime();
      for (const h of candidates) {
        if (
          !match ||
          Math.abs(h.openedAt.getTime() - orderTs) <
            Math.abs(match.openedAt.getTime() - orderTs)
        ) {
          match = h;
        }
      }
      if (!match) return { change: null, error: null };

      await db.tradeJournal.update({
        where: { id: row.tradeJournalId },
        data: {
          status: "CLOSED",
          exitPrice: match.closeAvgPrice,
          pnl: match.netProfit,
          closedAt: match.closedAt,
        },
      });
      return {
        change: {
          brokerOrderId: row.id,
          tradeJournalId: row.tradeJournalId,
          before: "FILLED→OPEN",
          after: "CLOSED",
          note: `Đã đóng tại ${match.closeAvgPrice}, PnL ${match.netProfit >= 0 ? "+" : ""}${match.netProfit.toFixed(2)} USDT`,
        },
        error: null,
      };
    } catch (e) {
      return {
        change: null,
        error:
          e instanceof BitgetError
            ? e.toVietnamese()
            : e instanceof Error
              ? e.message
              : "Lỗi không xác định",
      };
    }
  }

  return { change: null, error: null };
}

/**
 * Sync all of a user's open BrokerOrders. Caller is the route handler —
 * it owns rate limiting and auth.
 */
export async function syncUserBrokerOrders(
  userId: string,
): Promise<SyncResult> {
  const result: SyncResult = { scanned: 0, changes: [], errors: [] };

  const creds = await loadCreds<BitgetCreds>(userId, "BITGET");
  if (!creds) return result; // no Bitget connected = nothing to sync

  // Anything still in a non-terminal state for this user.
  const rows = await db.brokerOrder.findMany({
    where: {
      userId,
      broker: "BITGET",
      status: {
        in: ["PENDING", "PLACED", "PLACED_NO_SL", "FILLED", "UNKNOWN"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50, // bound work per run
  });

  result.scanned = rows.length;
  for (const row of rows) {
    const r = await syncOne(creds, row);
    if (r.change) result.changes.push(r.change);
    if (r.error)
      result.errors.push({ brokerOrderId: row.id, message: r.error });
  }
  return result;
}
