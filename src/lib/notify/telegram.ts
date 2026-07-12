/**
 * Telegram — ONE system bot for everyone.
 *
 * The bot token lives server-side in TELEGRAM_BOT_TOKEN (never exposed).
 * Users link by pressing Start on the bot via a deep link (see
 * telegram-link.ts + telegram-poll.ts), which stores their chat id on the
 * User row. Alerts then DM that chat through the shared bot.
 *
 * TELEGRAM_CHANNEL_ID (optional) is a public channel/group the bot posts
 * broadcast signals to (everyone who joins the channel sees them).
 *
 * All sends are fire-and-forget with a short timeout — a Telegram outage
 * must NEVER block or fail a sync/scan flow.
 */

import "server-only";
import { db } from "@/lib/db";

const API = "https://api.telegram.org";

export function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export function telegramEnabled(): boolean {
  return botToken() !== null;
}

let cachedUsername: string | null = null;

/** The bot's @username, needed to build t.me deep links. Cached. */
export async function getBotUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  const token = botToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/bot${token}/getMe`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { username?: string };
    };
    if (j.ok && j.result?.username) {
      cachedUsername = j.result.username;
      return cachedUsername;
    }
  } catch {
    // ignore — caller handles null
  }
  return null;
}

/** Low-level send to any chat id via the system bot. Never throws. */
export async function sendToChat(
  chatId: string | number,
  text: string,
): Promise<boolean> {
  const token = botToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        // Plain text — our messages carry symbols/numbers that would need
        // MarkdownV2 escaping; not worth the failure mode.
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}

/**
 * DM a user. No-op (false) when the bot isn't configured or the user hasn't
 * linked Telegram — callers don't need to pre-check.
 */
export async function notifyUser(
  userId: string,
  text: string,
): Promise<boolean> {
  if (!telegramEnabled()) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true },
  });
  if (!user?.telegramChatId) return false;
  return sendToChat(user.telegramChatId, text);
}

/**
 * Post to the public broadcast channel (kiểu B). No-op when the bot or
 * TELEGRAM_CHANNEL_ID isn't configured.
 */
export async function broadcastToChannel(text: string): Promise<boolean> {
  const channel = process.env.TELEGRAM_CHANNEL_ID;
  if (!telegramEnabled() || !channel) return false;
  return sendToChat(channel, text);
}
