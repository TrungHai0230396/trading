/**
 * Background broker sync — the server-side heartbeat that keeps every
 * user's journal honest even when no browser tab is open.
 *
 * Every tick:
 *   1. find users with active Bitget creds,
 *   2. run the (read-only, idempotent) syncUserBrokerOrders for each,
 *   3. forward each change note to the user's Telegram (if connected).
 *
 * Never throws — a cron tick that dies would stop all future ticks.
 */

import "server-only";
import { db } from "@/lib/db";
import { syncUserBrokerOrders } from "@/lib/brokers/sync";
import { notifyUser } from "@/lib/notify/telegram";

export async function runBrokerSyncForAllUsers(): Promise<void> {
  let userIds: string[] = [];
  try {
    const rows = await db.apiKey.findMany({
      where: { kind: "BITGET", isActive: true, label: null },
      select: { userId: true },
    });
    userIds = [...new Set(rows.map((r) => r.userId))];
  } catch (e) {
    console.error("[cron:sync] user lookup failed", e);
    return;
  }

  for (const userId of userIds) {
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
}
