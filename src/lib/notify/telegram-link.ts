/**
 * Telegram account-linking codes.
 *
 * A user asks to connect Telegram → we mint a short one-time code and hand
 * back a t.me/<bot>?start=<code> deep link. When they press Start, the bot
 * receives "/start <code>" (see telegram-poll.ts); we look the code up here,
 * bind that Telegram chat to the user, and burn the code.
 *
 * Stored in the DB (AppSetting rows keyed `tglink:<code>`), NOT in memory:
 * an in-memory map is wiped on every process restart/redeploy, which silently
 * invalidated every pending link and produced a stream of "liên kết hết hạn"
 * errors. DB-backed codes survive restarts. Each fresh "Kết nối" click clears
 * the user's older pending codes, so only the newest deep link is ever valid.
 */

import "server-only";
import crypto from "node:crypto";
import { db } from "@/lib/db";

const TTL_MS = 30 * 60_000;
const PREFIX = "tglink:";

export async function createLinkCode(userId: string): Promise<string> {
  // Drop this user's older pending codes so stale deep links stop working.
  await db.appSetting.deleteMany({
    where: { userId, key: { startsWith: PREFIX } },
  });
  const code = crypto.randomBytes(12).toString("base64url");
  await db.appSetting.create({
    data: {
      userId,
      key: `${PREFIX}${code}`,
      value: { expiresAt: Date.now() + TTL_MS },
    },
  });
  return code;
}

/** Returns the userId and burns the code, or null if invalid/expired. */
export async function consumeLinkCode(code: string): Promise<string | null> {
  if (!code) return null;
  const row = await db.appSetting.findFirst({
    where: { key: `${PREFIX}${code}` },
    select: { id: true, userId: true, value: true },
  });
  if (!row) return null;
  // Burn it regardless of expiry (one-time use).
  await db.appSetting.delete({ where: { id: row.id } }).catch(() => {});
  const expiresAt = (row.value as { expiresAt?: number } | null)?.expiresAt ?? 0;
  if (expiresAt < Date.now()) return null;
  return row.userId;
}
