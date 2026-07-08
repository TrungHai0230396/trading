/**
 * Feature entitlements — who may use the REAL-MONEY write actions
 * (place / cancel / close / edit SL-TP on a live exchange).
 *
 * Commercial posture: the public product is READ-ONLY (journal +
 * calculator + read-only broker sync). Auto-trade is a restricted
 * capability, granted per user:
 *
 *   1. AUTOTRADE_ALLOWED_EMAILS — comma-separated env allowlist. Not
 *      settable from any endpoint, so it cannot be self-granted. This is
 *      how the owner keeps full functionality on their own account.
 *   2. AppSetting key `feature:autotrade` = { enabled: true } — an escape
 *      hatch for granting individual users later (via DB / future admin
 *      UI). There is deliberately NO public route that writes this key.
 *
 * The global kill-switch (BITGET_AUTOPLACE_ENABLED) still applies on top:
 * entitled users lose the feature too when it's flipped off.
 */

import "server-only";
import { db } from "@/lib/db";

export async function canAutoTrade(userId: string): Promise<boolean> {
  // Global kill-switch gates everyone, including allowlisted users.
  if (process.env.BITGET_AUTOPLACE_ENABLED !== "true") return false;

  const allowlist = (process.env.AUTOTRADE_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length > 0) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user && allowlist.includes(user.email.toLowerCase())) return true;
  }

  const row = await db.appSetting.findUnique({
    where: { userId_key: { userId, key: "feature:autotrade" } },
  });
  const v = row?.value as { enabled?: boolean } | undefined;
  return v?.enabled === true;
}

/** Standard 403 payload for write routes when the caller lacks the grant. */
export const AUTOTRADE_FORBIDDEN_MESSAGE =
  "Tài khoản của bạn đang ở chế độ chỉ-đọc (read-only). Tính năng đặt/sửa lệnh thật chưa mở cho tài khoản này.";
