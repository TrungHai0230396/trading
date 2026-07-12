/**
 * Owner notifications — pings the operator's own Telegram (their linked
 * chat on the system bot) about events they'd want immediately, e.g. new
 * feedback. Best-effort and non-throwing: no admin/Telegram link → no ping.
 */

import "server-only";
import { db } from "@/lib/db";
import { adminEmails } from "@/lib/admin";
import { sendToChat, telegramEnabled } from "@/lib/notify/telegram";

export async function notifyOwner(text: string): Promise<void> {
  try {
    if (!telegramEnabled()) return;
    const emails = adminEmails();
    if (emails.length === 0) return;

    const admin = await db.user.findFirst({
      where: { email: { in: emails }, telegramChatId: { not: null } },
      select: { telegramChatId: true },
    });
    if (admin?.telegramChatId) {
      await sendToChat(admin.telegramChatId, text);
    }
  } catch {
    // Never let an owner-notification failure affect the caller's request.
  }
}
