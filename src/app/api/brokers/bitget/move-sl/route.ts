/**
 * POST /api/brokers/bitget/move-sl
 *
 * Move the Stop Loss of an OPEN position to a new price. Currently the
 * client only sends `target: "entry"` (the break-even case) — extending
 * to arbitrary prices is straightforward.
 *
 * Bitget's `place-tpsl-order` with planType=pos_loss is idempotent per
 * (symbol, holdSide) — calling it again with a new triggerPrice
 * replaces the existing SL. So we don't have to find+cancel the old one
 * ourselves.
 *
 * Real-money write — requires confirm "OK" + kill-switch + auth + rate-limit.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCreds } from "@/lib/brokers/store";
import { rateLimit } from "@/lib/brokers/rate-limit";
import {
  fetchContractSpec,
  holdSideForTpsl,
  placePositionSL,
  BitgetError,
  type BitgetCreds,
} from "@/lib/brokers/bitget";
import { roundToStep, stepDecimals } from "@/lib/brokers/order-math";

export const runtime = "nodejs";

const Body = z.object({
  brokerOrderId: z.string().min(1),
  target: z.enum(["entry"]),
  confirmText: z.string(),
});

export async function POST(req: Request) {
  if (process.env.BITGET_AUTOPLACE_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Tính năng đặt/sửa lệnh thật đang tạm dừng." },
      { status: 503 },
    );
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`broker-move-sl:${userId}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều lần sửa SL trong 1 phút. Đợi rồi thử lại." },
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
  // Break-even SL only makes sense when the position is open. PLACED
  // means the entry hasn't filled yet → no position → no SL to move.
  if (order.status !== "FILLED") {
    return NextResponse.json(
      {
        error: `Lệnh đang ở trạng thái ${order.status}, chưa có vị thế để kéo SL. Chỉ dùng được khi đã khớp (FILLED).`,
      },
      { status: 409 },
    );
  }

  const journal = await db.tradeJournal.findFirst({
    where: { id: order.tradeJournalId, userId },
    select: { entryPrice: true, status: true },
  });
  if (!journal) {
    return NextResponse.json(
      { error: "Không tìm thấy nhật ký liên kết." },
      { status: 404 },
    );
  }
  if (journal.status !== "OPEN") {
    return NextResponse.json(
      { error: "Vị thế đã đóng — không cần kéo SL." },
      { status: 409 },
    );
  }
  const entryPrice = Number(journal.entryPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return NextResponse.json(
      { error: "Giá entry không hợp lệ trong nhật ký." },
      { status: 400 },
    );
  }

  const creds = await loadCreds<BitgetCreds>(userId, "BITGET");
  if (!creds) {
    return NextResponse.json(
      { error: "Chưa kết nối Bitget." },
      { status: 404 },
    );
  }

  // Normalize entry to the symbol's tick.
  let spec: Awaited<ReturnType<typeof fetchContractSpec>>;
  try {
    spec = await fetchContractSpec(order.symbol);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Không tra được hợp đồng." },
      { status: 502 },
    );
  }
  if (!spec) {
    return NextResponse.json(
      { error: "Không tra được hợp đồng Bitget." },
      { status: 404 },
    );
  }
  const tick = spec.priceEndStep;
  const newSL = roundToStep(entryPrice, tick).toFixed(stepDecimals(tick));

  // 43011 guard: one-way accounts need buy/sell, hedge needs long/short.
  const holdSide = holdSideForTpsl(order.side, order.posMode);

  try {
    const result = await placePositionSL(creds, {
      symbol: order.symbol,
      holdSide,
      triggerPrice: newSL,
      triggerType: "mark_price",
      clientOid: `mvsl_${order.id}_${Date.now()}`.slice(0, 36),
    });

    await db.brokerOrder.update({
      where: { id: order.id },
      data: { presetStopLoss: newSL },
    });
    // Also reflect in the journal so the user's plan stays in sync.
    await db.tradeJournal.update({
      where: { id: order.tradeJournalId },
      data: { stopLoss: Number(newSL) },
    });

    return NextResponse.json({
      ok: true,
      newSL,
      tpslOrderId: result.orderId,
    });
  } catch (e) {
    if (e instanceof BitgetError) {
      return NextResponse.json(
        {
          error: `Bitget từ chối (${e.code}): ${e.bitgetMsg ?? e.message}`,
          code: e.code,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi không xác định." },
      { status: 502 },
    );
  }
}
