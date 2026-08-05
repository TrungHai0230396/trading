/**
 * Background broker sync — the server-side heartbeat that keeps every
 * user's journal honest even when no browser tab is open.
 *
 * Every tick:
 *   1. find users with active Bitget creds,
 *   2. run the (read-only, idempotent) syncUserBrokerOrders for each,
 *   3. forward each change note to the user's Telegram (if connected).
 *
 * Then, at a slower cadence, re-read every connected exchange's open
 * positions (importOpenPositions) so imported journal rows get closed when
 * the position is closed on the exchange. Without this the reconciliation
 * only runs while the journal page is open in a browser — exactly the users
 * who stop opening the app are the ones whose journal rots.
 *
 * Never throws — a cron tick that dies would stop all future ticks.
 */

import "server-only";
import { db } from "@/lib/db";
import { syncUserBrokerOrders } from "@/lib/brokers/sync";
import {
  importOpenPositions,
  BROKER_LABEL,
  type BrokerClosure,
} from "@/lib/brokers/import-positions";
import { notifyUser } from "@/lib/notify/telegram";

/** Every broker the position importer can read. */
const IMPORT_KINDS = ["BITGET", "BINANCE", "MEXC", "OKX"] as const;

/**
 * Position import runs far slower than the 2-minute order sync: it hits every
 * connected exchange for every user, and one small VPS shares one IP for all
 * of them. Ten minutes is well inside the window where a stale OPEN row still
 * feels wrong to nobody, and the journal page reconciles at 60s anyway while
 * someone is actually looking.
 */
const IMPORT_INTERVAL_MS = 10 * 60_000;

/** Per-user cron state (AppSetting is keyed by userId+key). */
const IMPORT_STATE_KEY = "cron:position-import";

async function lastImportAt(userId: string): Promise<number> {
  const row = await db.appSetting.findUnique({
    where: { userId_key: { userId, key: IMPORT_STATE_KEY } },
    select: { value: true },
  });
  const raw: unknown = row?.value;
  if (!raw || typeof raw !== "object") return 0;
  const at = Number((raw as { at?: unknown }).at);
  return Number.isFinite(at) ? at : 0;
}

async function markImported(userId: string, at: number): Promise<void> {
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: IMPORT_STATE_KEY } },
    create: { userId, key: IMPORT_STATE_KEY, value: { at } },
    update: { value: { at } },
  });
}

/** Facts only — what closed and for how much. Never a suggestion. */
function closureLine(c: BrokerClosure): string {
  const head = `🏁 ${BROKER_LABEL[c.broker]}: ${c.symbol} ${c.direction} đã đóng trên sàn`;
  if (c.pnl === null) {
    return `${head} — mở Nhật ký để nhập giá thoát và lãi/lỗ thật.`;
  }
  const r =
    c.rMultiple !== null
      ? ` (${c.rMultiple >= 0 ? "+" : ""}${c.rMultiple.toFixed(2)}R)`
      : "";
  return `${head}. PnL ${c.pnl >= 0 ? "+" : ""}${c.pnl.toFixed(2)} USDT${r}`;
}

async function importPositionsForUser(userId: string): Promise<void> {
  const now = Date.now();
  if (now - (await lastImportAt(userId)) < IMPORT_INTERVAL_MS) return;
  // Claim the slot BEFORE the work: a broker that times out for 90 seconds
  // must not be retried on every 2-minute tick.
  await markImported(userId, now);

  const result = await importOpenPositions(userId);
  const firstErr = result.byBroker.find((b) => b.error);
  if (firstErr) {
    console.warn(
      `[cron:sync] user=${userId} import ${firstErr.broker}: ${firstErr.error}`,
    );
  }
  if (result.closures.length === 0) return;
  await notifyUser(userId, result.closures.map(closureLine).join("\n"));
}

export async function runBrokerSyncForAllUsers(): Promise<void> {
  let rows: Array<{ userId: string; kind: string }> = [];
  try {
    rows = await db.apiKey.findMany({
      where: {
        kind: { in: [...IMPORT_KINDS] },
        isActive: true,
        label: null,
      },
      select: { userId: true, kind: true },
    });
  } catch (e) {
    console.error("[cron:sync] user lookup failed", e);
    return;
  }

  // Order sync only understands the two brokers it can place through; the
  // position import covers all four.
  const orderSyncUsers = new Set(
    rows
      .filter((r) => r.kind === "BITGET" || r.kind === "BINANCE")
      .map((r) => r.userId),
  );
  const userIds = [...new Set(rows.map((r) => r.userId))];

  for (const userId of userIds) {
    if (orderSyncUsers.has(userId)) {
      try {
        const result = await syncUserBrokerOrders(userId);
        for (const c of result.changes) {
          const icon =
            c.after === "FILLED" ? "🟢" : c.after === "CLOSED" ? "🏁" : "⚪";
          const text = `${icon} Bitget: ${c.before} → ${c.after}${c.note ? `\n${c.note}` : ""}`;
          // Fire-and-forget; a Telegram failure must not affect the sync loop.
          await notifyUser(userId, text);
        }
        if (result.errors.length > 0) {
          console.warn(
            `[cron:sync] user=${userId} errors=${result.errors.length}: ${result.errors[0]?.message}`,
          );
        }
      } catch (e) {
        console.error(`[cron:sync] user=${userId} failed`, e);
      }
    }

    // Separate try: an order-sync failure must not skip the reconciliation
    // that stops the journal filling with phantom open trades.
    try {
      await importPositionsForUser(userId);
    } catch (e) {
      console.error(`[cron:sync] user=${userId} position import failed`, e);
    }
  }
}
