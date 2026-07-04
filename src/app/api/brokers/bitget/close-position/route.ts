/**
 * POST /api/brokers/bitget/close-position
 *
 * Flash-close (market) the OPEN position tied to a FILLED BrokerOrder.
 * Real-money write — kill-switch + auth + rate-limit + confirm "OK".
 *
 * After Bitget confirms, we don't hard-set the journal to CLOSED here —
 * the exit price + realized PnL come from position-history, which the
 * sync job reads. We flag the BrokerOrder so sync picks it up promptly.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCreds } from "@/lib/brokers/store";
import { rateLimit } from "@/lib/brokers/rate-limit";
import {
  flashClosePosition,
  BitgetError,
  type BitgetCreds,
} from "@/lib/brokers/bitget";
import { syncUserBrokerOrders } from "@/lib/brokers/sync";

export const runtime = "nodejs";

const Body = z.object({
  brokerOrderId: z.string().min(1),
  confirmText: z.string(),
});

export async function POST(req: Request) {
  if (process.env.BITGET_AUTOPLACE_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Tính năng đặt/đóng lệnh thật đang tạm dừng." },
      { status: 503 },
    );
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`broker-close:${userId}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều lần đóng lệnh trong 1 phút. Đợi rồi thử lại." },
      { status: 429 },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }
  if (parsed.data.confirmText.trim().toUpperCase() !== "OK") {
    return NextResponse.json(
      { error: 'Phải gõ "OK" trong hộp xác nhận.' },
      { status: 400 },
    );
  }

  const order = await db.brokerOrder.findFirst({
    where: { id: parsed.data.brokerOrderId, userId, broker: "BITGET" },
  });
  if (!order) {
    return NextResponse.json(
      { error: "Không tìm thấy lệnh broker." },
      { status: 404 },
    );
  }
  if (order.status !== "FILLED") {
    return NextResponse.json(
      {
        error: `Lệnh đang ở trạng thái ${order.status}, chưa có vị thế để đóng. Chỉ dùng được khi đã khớp (FILLED).`,
      },
      { status: 409 },
    );
  }

  const creds = await loadCreds<BitgetCreds>(userId, "BITGET");
  if (!creds) {
    return NextResponse.json(
      { error: "Chưa kết nối Bitget." },
      { status: 404 },
    );
  }

  // Flash-close: holdSide is only meaningful (and only accepted as
  // long/short) in hedge mode. In one-way mode the symbol has at most one
  // position — omit it or Bitget may reject with 43011.
  const holdSide =
    order.posMode === "hedge_mode"
      ? order.side === "buy"
        ? ("long" as const)
        : ("short" as const)
      : undefined;

  try {
    await flashClosePosition(creds, { symbol: order.symbol, holdSide });
  } catch (e) {
    if (e instanceof BitgetError) {
      return NextResponse.json(
        {
          error: `Bitget từ chối đóng (${e.code}): ${e.bitgetMsg ?? e.message}`,
          code: e.code,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi khi đóng vị thế." },
      { status: 502 },
    );
  }

  // Reconcile immediately so the journal picks up exit price + realized PnL
  // from Bitget's position history. Best-effort — a failure here doesn't
  // undo the (successful) close.
  let synced = false;
  try {
    const result = await syncUserBrokerOrders(userId);
    synced = result.changes.some((c) => c.brokerOrderId === order.id);
  } catch {
    /* sync will run again on next journal load */
  }

  return NextResponse.json({ ok: true, brokerOrderId: order.id, synced });
}
