/**
 * Telegram account-linking codes.
 *
 * A user asks to connect Telegram → we mint a short one-time code and hand
 * back a t.me/<bot>?start=<code> deep link. When they press Start, the bot
 * receives "/start <code>" (see telegram-poll.ts); we look the code up here,
 * bind that Telegram chat to the user, and burn the code.
 *
 * In-memory + single-container (same design as the rate limiter / crons).
 * Codes are short-lived (10 min) so a process restart losing them is
 * harmless — the user just clicks "Kết nối" again.
 */

import "server-only";
import crypto from "node:crypto";

type Pending = { userId: string; expiresAt: number };

const TTL_MS = 10 * 60_000;
const codes = new Map<string, Pending>();

export function createLinkCode(userId: string): string {
  // URL-safe, no ambiguous chars needed — it only travels inside a t.me link.
  const code = crypto.randomBytes(12).toString("base64url");
  codes.set(code, { userId, expiresAt: Date.now() + TTL_MS });

  // Opportunistic sweep so abandoned codes don't accumulate.
  if (codes.size > 5_000) {
    const now = Date.now();
    for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k);
  }
  return code;
}

/** Returns the userId and burns the code, or null if invalid/expired. */
export function consumeLinkCode(code: string): string | null {
  const p = codes.get(code);
  if (!p) return null;
  codes.delete(code);
  if (p.expiresAt < Date.now()) return null;
  return p.userId;
}
