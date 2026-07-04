/**
 * POST /api/brokers/bitget/set-tpsl
 *
 * Set/replace the Stop Loss and/or Take Profit of an OPEN position at
 * arbitrary prices — the general form of move-sl (which is hard-wired to
 * break-even). Bitget's pos_loss / pos_profit plan orders are idempotent
 * per (symbol, holdSide): re-submitting replaces the existing trigger.
 *
 * Real-money write — kill-switch + auth + rate-limit + confirm "OK".
 * Validation mirrors the order route: prices are tick-rounded AWAY from
 * entry, then side-checked against the journal entry price.
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
import {
  roundAwayFromEntry,
  stepDecimals,
  validateStopProfit,
} from "@/lib/brokers/order-math";

export const runtime = "nodejs";

const Body = z
  .object({
    brokerOrderId: z.string().min(1),
    stopLoss: z.number().positive().finite().optional(),
    takeProfit: z.number().positive().finite().optional(),
    confirmText: z.string(),
  })
  .refine((b) => b.stopLoss !== undefined || b.takeProfit !== undefined, {
    message: "Cần ít nhất một trong hai: Stop Loss hoặc Take Profit.",
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

  if (!rateLimit(`broker-tpsl:${userId}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều lần sửa SL/TP trong 1 phút. Đợi rồi thử lại." },
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
        error: `Lệnh đang ở trạng thái ${order.status}, chưa có vị thế. Chỉ sửa được SL/TP khi đã khớp (FILLED).`,
      },
      { status: 409 },
    );
  }

  const journal = await db.tradeJournal.findFirst({
    where: { id: order.tradeJournalId, userId },
    select: { entryPrice: true, status: true, direction: true },
  });
  if (!journal || journal.status !== "OPEN") {
    return NextResponse.json(
      { error: "Vị thế đã đóng hoặc không tìm thấy nhật ký." },
      { status: 409 },
    );
  }
  const entry = Number(journal.entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) {
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
  const dec = stepDecimals(tick);
  const direction = journal.direction as "LONG" | "SHORT";

  const slRounded =
    parsed.data.stopLoss !== undefined
      ? roundAwayFromEntry(parsed.data.stopLoss, entry, tick)
      : undefined;
  const tpRounded =
    parsed.data.takeProfit !== undefined
      ? roundAwayFromEntry(parsed.data.takeProfit, entry, tick)
      : undefined;

  const validation = validateStopProfit({
    direction,
    entry,
    stopLoss: slRounded,
    takeProfit: tpRounded,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // 43011 guard: one-way accounts need buy/sell, hedge needs long/short.
  const holdSide = holdSideForTpsl(order.side, order.posMode);
  const results: { sl?: string; tp?: string } = {};

  try {
    if (slRounded !== undefined) {
      const slStr = slRounded.toFixed(dec);
      await placePositionSL(creds, {
        symbol: order.symbol,
        holdSide,
        triggerPrice: slStr,
        planType: "pos_loss",
        triggerType: "mark_price",
        clientOid: `tpsl_${order.id}_sl_${Date.now()}`.slice(0, 36),
      });
      results.sl = slStr;
    }
    if (tpRounded !== undefined) {
      const tpStr = tpRounded.toFixed(dec);
      await placePositionSL(creds, {
        symbol: order.symbol,
        holdSide,
        triggerPrice: tpStr,
        planType: "pos_profit",
        triggerType: "mark_price",
        clientOid: `tpsl_${order.id}_tp_${Date.now()}`.slice(0, 36),
      });
      results.tp = tpStr;
    }
  } catch (e) {
    // Partial success is possible (SL set, TP rejected). Report what
    // landed so the user knows the true state.
    const landed =
      results.sl || results.tp
        ? ` Đã đặt được: ${results.sl ? `SL ${results.sl}` : ""}${results.sl && results.tp ? ", " : ""}${results.tp ? `TP ${results.tp}` : ""}.`
        : "";
    if (e instanceof BitgetError) {
      return NextResponse.json(
        {
          error: `Bitget từ chối (${e.code}): ${e.bitgetMsg ?? e.message}.${landed}`,
          code: e.code,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: `${e instanceof Error ? e.message : "Lỗi không xác định"}.${landed}`,
      },
      { status: 502 },
    );
  }

  // Mirror the accepted values into our rows.
  await db.brokerOrder.update({
    where: { id: order.id },
    data: {
      ...(results.sl ? { presetStopLoss: results.sl } : {}),
      ...(results.tp ? { presetTakeProfit: results.tp } : {}),
    },
  });
  await db.tradeJournal.update({
    where: { id: order.tradeJournalId },
    data: {
      ...(results.sl ? { stopLoss: Number(results.sl) } : {}),
      ...(results.tp ? { takeProfit: Number(results.tp) } : {}),
    },
  });

  return NextResponse.json({ ok: true, ...results });
}
