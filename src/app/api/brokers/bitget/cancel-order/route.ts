/**
 * POST /api/brokers/bitget/cancel-order
 *
 * Cancel a real Bitget limit order tied to a BrokerOrder row. Real-money
 * write action — requires confirmText from the client (defense vs accidents).
 *
 * After Bitget confirms, the BrokerOrder.status is set to CANCELLED and
 * the linked journal row's status is set to CANCELED (only if it was
 * still OPEN — preserves user manual overrides).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCreds } from "@/lib/brokers/store";
import { rateLimit } from "@/lib/brokers/rate-limit";
import {
  canAutoTrade,
  AUTOTRADE_FORBIDDEN_MESSAGE,
} from "@/lib/brokers/entitlements";
import {
  cancelOrder,
  BitgetError,
  type BitgetCreds,
} from "@/lib/brokers/bitget";
import {
  cancelOrder as binanceCancelOrder,
  BinanceError,
  type BinanceCreds,
} from "@/lib/brokers/binance";

export const runtime = "nodejs";

const Body = z.object({
  brokerOrderId: z.string().min(1),
  confirmText: z.string(),
});

export async function POST(req: Request) {
  // Kill-switch — same env var the place-order endpoint uses.
  if (process.env.BITGET_AUTOPLACE_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Tính năng đặt/huỷ lệnh thật đang tạm dừng." },
      { status: 503 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  // Entitlement — read-only accounts cannot touch live orders/positions.
  if (!(await canAutoTrade(userId))) {
    return NextResponse.json(
      { error: AUTOTRADE_FORBIDDEN_MESSAGE },
      { status: 403 },
    );
  }

  // Per-user rate limit — generous since cancel is corrective.
  if (!rateLimit(`broker-cancel:${userId}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều lần huỷ trong 1 phút. Đợi rồi thử lại." },
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
      { error: 'Phải gõ "OK" trong hộp xác nhận để huỷ lệnh thật.' },
      { status: 400 },
    );
  }

  // Dispatch by the order's own broker — the /bitget/ path is historical.
  const order = await db.brokerOrder.findFirst({
    where: { id: parsed.data.brokerOrderId, userId },
  });
  if (!order) {
    return NextResponse.json(
      { error: "Không tìm thấy lệnh broker." },
      { status: 404 },
    );
  }
  if (order.status !== "PLACED" && order.status !== "PLACED_NO_SL") {
    return NextResponse.json(
      {
        error: `Lệnh đang ở trạng thái ${order.status} — không thể huỷ.`,
      },
      { status: 409 },
    );
  }

  try {
    if (order.broker === "BINANCE") {
      const creds = await loadCreds<BinanceCreds>(userId, "BINANCE");
      if (!creds) {
        return NextResponse.json(
          { error: "Chưa kết nối Binance." },
          { status: 404 },
        );
      }
      try {
        await binanceCancelOrder(creds, {
          symbol: order.symbol,
          orderId: order.externalOrderId ?? undefined,
          clientOid: order.clientOid,
        });
      } catch (e) {
        // -2011/-2013 = order already gone — treat as success.
        if (
          !(
            e instanceof BinanceError &&
            (e.code === "-2011" || e.code === "-2013")
          )
        )
          throw e;
      }
      // Sweep the closePosition brackets that were placed with the entry —
      // without a position they'd linger as orphan conditionals.
      const rawIds = order.rawResponse as {
        slOrderId?: string | null;
        tpOrderId?: string | null;
      } | null;
      for (const id of [rawIds?.slOrderId, rawIds?.tpOrderId]) {
        if (id) {
          await binanceCancelOrder(creds, {
            symbol: order.symbol,
            orderId: id,
          }).catch(() => {});
        }
      }
    } else {
      const creds = await loadCreds<BitgetCreds>(userId, "BITGET");
      if (!creds) {
        return NextResponse.json(
          { error: "Chưa kết nối Bitget." },
          { status: 404 },
        );
      }
      try {
        await cancelOrder(creds, {
          symbol: order.symbol,
          orderId: order.externalOrderId ?? undefined,
          clientOid: order.clientOid,
        });
      } catch (e) {
        if (!(e instanceof BitgetError && e.code === "40768")) throw e;
      }
    }
  } catch (e) {
    if (e instanceof BitgetError || e instanceof BinanceError) {
      return NextResponse.json(
        { error: e.toVietnamese(), code: e.code },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi khi huỷ lệnh" },
      { status: 502 },
    );
  }

  // Bitget confirmed. Update our state.
  await db.brokerOrder.update({
    where: { id: order.id },
    data: { status: "CANCELLED" },
  });
  await db.tradeJournal.updateMany({
    where: { id: order.tradeJournalId, userId, status: "OPEN" },
    data: { status: "CANCELED" },
  });

  return NextResponse.json({
    ok: true,
    brokerOrderId: order.id,
    tradeJournalId: order.tradeJournalId,
  });
}
