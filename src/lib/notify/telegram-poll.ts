/**
 * Telegram long-poll loop — the receive side of the ONE system bot.
 *
 * Long-polling (getUpdates) instead of a webhook: no public HTTPS URL
 * needed, works identically on localhost and a single-container VPS, and
 * fits the existing in-process background-loop model (crons). Exactly one
 * poller may run per bot token, which the single container guarantees.
 *
 * Handles:
 *   /start <code>  → bind this chat to the user who generated <code>
 *   /start         → nudge them to open the app for a link
 *   /stop          → unlink this chat
 */

import "server-only";
import { db } from "@/lib/db";
import { botToken, sendToChat } from "@/lib/notify/telegram";
import { consumeLinkCode } from "@/lib/notify/telegram-link";
import { rateLimit } from "@/lib/brokers/rate-limit";

const API = "https://api.telegram.org";

type TgUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id: number; type?: string };
    from?: { first_name?: string };
  };
};

async function handleUpdate(u: TgUpdate): Promise<void> {
  const msg = u.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim();
  if (!chatId || !text) return;

  // Untrusted input: anyone can DM the bot. Throttle per chat so a flood
  // can't back up the serial queue (and delay real users' /start) or drive
  // unbounded DB writes/replies.
  if (!rateLimit(`tg-in:${chatId}`, 5, 60_000)) return;

  if (text === "/stop") {
    // Only write + reply if this chat was actually linked — strangers
    // spamming /stop shouldn't trigger DB writes or bot replies.
    const { count } = await db.user.updateMany({
      where: { telegramChatId: String(chatId) },
      data: { telegramChatId: null, telegramLinkedAt: null },
    });
    if (count > 0) {
      await sendToChat(
        chatId,
        "Đã ngắt kết nối Nhật Ký Trade. Bạn sẽ không nhận thông báo nữa. Kết nối lại bất cứ lúc nào trong app.",
      );
    }
    return;
  }

  if (text.startsWith("/start")) {
    const code = text.slice("/start".length).trim();
    if (!code) {
      await sendToChat(
        chatId,
        "👋 Chào bạn! Để nhận thông báo từ Nhật Ký Trade, mở app → Cài đặt → Kết nối Telegram và bấm nút ở đó.",
      );
      return;
    }
    const userId = await consumeLinkCode(code);
    if (!userId) {
      await sendToChat(
        chatId,
        "Liên kết đã hết hạn hoặc không hợp lệ. Mở app bấm 'Kết nối Telegram' lại giúp mình nhé.",
      );
      return;
    }
    // Bind. Clear any other account currently on this chat first so one
    // Telegram chat maps to exactly one Nhật Ký Trade account.
    await db.user.updateMany({
      where: { telegramChatId: String(chatId), NOT: { id: userId } },
      data: { telegramChatId: null, telegramLinkedAt: null },
    });
    await db.user.update({
      where: { id: userId },
      data: { telegramChatId: String(chatId), telegramLinkedAt: new Date() },
    });
    await sendToChat(
      chatId,
      "✅ Đã kết nối Nhật Ký Trade! Bạn sẽ nhận cảnh báo tín hiệu đồng thuận (theo watchlist của bạn) ở đây. Gõ /stop để ngắt.",
    );
  }
}

/**
 * Start the long-poll loop. Idempotent-ish: guarded by a module flag so a
 * dev HMR re-import doesn't spawn a second poller.
 */
let running = false;

export function startTelegramPolling(): void {
  if (running) return;
  if (!botToken()) {
    console.log("[telegram] TELEGRAM_BOT_TOKEN not set — poller disabled");
    return;
  }
  running = true;

  let offset = 0;
  const loop = async (): Promise<void> => {
    const token = botToken();
    if (!token) {
      running = false;
      return;
    }
    // Delay before the NEXT poll. On a healthy 200/ok response it's 0 because
    // getUpdates itself already blocked ~50s server-side. On an HTTP/JSON
    // error (401/409/429/5xx — which fetch RESOLVES, not throws) there is no
    // server-side hold, so we MUST back off or the loop becomes a request
    // storm (e.g. a leftover webhook → permanent 409).
    let delay = 3_000;
    try {
      const res = await fetch(
        `${API}/bot${token}/getUpdates?timeout=50&offset=${offset}&allowed_updates=["message"]`,
        { signal: AbortSignal.timeout(60_000), cache: "no-store" },
      );
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: TgUpdate[];
        parameters?: { retry_after?: number };
      };
      if (res.ok && j.ok && Array.isArray(j.result)) {
        delay = 0;
        for (const u of j.result) {
          offset = Math.max(offset, u.update_id + 1);
          try {
            await handleUpdate(u);
          } catch (e) {
            console.error("[telegram] update handler failed", e);
          }
        }
      } else {
        // Honor 429 retry_after; otherwise a fixed backoff.
        delay =
          typeof j.parameters?.retry_after === "number"
            ? Math.max(1, j.parameters.retry_after) * 1000
            : 3_000;
        console.error(
          `[telegram] getUpdates not ok (http=${res.status}) — backing off ${delay}ms`,
        );
      }
    } catch {
      // Network blip / 60s abort — back off before retrying.
      delay = 3_000;
    }
    setTimeout(loop, delay);
  };

  void loop();
  console.log("[telegram] long-poll loop started");
}
