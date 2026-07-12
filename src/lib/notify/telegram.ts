/**
 * Telegram notification channel.
 *
 * Credentials: { botToken, chatId } stored encrypted in ApiKey (kind
 * TELEGRAM) via the same store the brokers use. The bot token is a secret;
 * the chat id is not, but bundling both in one blob keeps the load path
 * single-read.
 *
 * Send path is fire-and-forget with a short timeout — a Telegram outage
 * must NEVER block or fail a sync/order flow. Callers get a boolean and
 * may log, but should not throw on false.
 */

import "server-only";
import { loadCreds } from "@/lib/brokers/store";

export type TelegramCreds = {
  botToken: string;
  chatId: string;
};

const API = "https://api.telegram.org";

/**
 * Verify the token by calling getMe, then send a test message to the chat.
 * Returns Vietnamese error strings suitable for direct UI display.
 */
export async function testTelegram(
  creds: TelegramCreds,
): Promise<{ ok: true; botName: string } | { ok: false; error: string }> {
  try {
    const meRes = await fetch(`${API}/bot${creds.botToken}/getMe`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    const me = (await meRes.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (!me.ok) {
      return {
        ok: false,
        error:
          me.description === "Unauthorized"
            ? "Bot token không hợp lệ. Kiểm tra lại token từ @BotFather."
            : `Telegram từ chối token: ${me.description ?? "không rõ"}`,
      };
    }
    const sent = await sendTelegram(
      creds,
      "✅ Vela đã kết nối Telegram thành công. Bạn sẽ nhận thông báo lệnh và tín hiệu quét ở đây.",
    );
    if (!sent) {
      return {
        ok: false,
        error:
          "Token đúng nhưng không gửi được tin tới chat ID này. Đã bấm Start cho bot chưa? Chat ID có đúng không?",
      };
    }
    return { ok: true, botName: me.result?.username ?? "bot" };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "TimeoutError"
          ? "Telegram không phản hồi trong 8 giây."
          : e instanceof Error
            ? e.message
            : "Lỗi không xác định",
    };
  }
}

/** Send one message. Returns false on any failure — never throws. */
export async function sendTelegram(
  creds: TelegramCreds,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${API}/bot${creds.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: creds.chatId,
        text,
        // Plain text — our messages contain user symbols and numbers that
        // would need escaping in MarkdownV2; not worth the failure mode.
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
 * Load creds and send in one call. No-op (returns false) when the user
 * hasn't connected Telegram — callers don't need to pre-check.
 */
export async function notifyUser(
  userId: string,
  text: string,
): Promise<boolean> {
  const creds = await loadCreds<TelegramCreds>(userId, "TELEGRAM");
  if (!creds) return false;
  return sendTelegram(creds, text);
}
