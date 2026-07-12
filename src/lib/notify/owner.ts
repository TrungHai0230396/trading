/**
 * Owner notifications — pings the operator's own Telegram (the admin
 * account's connected bot) about events they'd want to know immediately,
 * e.g. a new feedback submission. Best-effort and non-throwing: a missing
 * admin/Telegram config just means no ping, never a failed request.
 */

import "server-only";
import { db } from "@/lib/db";
import { adminEmails } from "@/lib/admin";
import { loadCreds, type BrokerKind } from "@/lib/brokers/store";
import { sendTelegram, type TelegramCreds } from "@/lib/notify/telegram";

export async function notifyOwner(text: string): Promise<void> {
  try {
    const emails = adminEmails();
    if (emails.length === 0) return;

    const admins = await db.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });

    // First admin with a connected Telegram wins — the owner only needs one
    // ping, not one per admin account.
    for (const a of admins) {
      const creds = await loadCreds<TelegramCreds>(
        a.id,
        "TELEGRAM" as BrokerKind,
      );
      if (creds) {
        await sendTelegram(creds, text);
        return;
      }
    }
  } catch {
    // Never let an owner-notification failure affect the caller's request.
  }
}
