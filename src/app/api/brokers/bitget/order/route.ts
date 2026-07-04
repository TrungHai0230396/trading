/**
 * POST /api/brokers/bitget/order
 *
 * Real-money endpoint. Auto-places a Bitget USDT-FUTURES order tied to
 * an existing TradeJournal row. The journal write is independent — if
 * this endpoint fails, the user still has their plan saved.
 *
 * Safety rails (matching the Phase 2 design critique):
 *   - Kill-switch via env BITGET_AUTOPLACE_ENABLED ("true" required).
 *   - Auth + per-user rate limit (5 attempts / journal / minute).
 *   - clientOid = "tj_<journalId>_<attempt>" — DB unique on (broker,clientOid).
 *   - Refuse hedge-mode accounts.
 *   - Normalize size/price to contract step.
 *   - Validate min size + min notional.
 *   - Pre-check available balance vs estimated margin.
 *   - Skip setLeverage if a position is already open on the symbol.
 *   - After place succeeds, verify presetStopLoss actually registered
 *     on Bitget; flag PLACED_NO_SL if not.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCreds } from "@/lib/brokers/store";
import { rateLimit } from "@/lib/brokers/rate-limit";
import {
  fetchContractSpec,
  getAccountBalance,
  getOpenPositions,
  getOrderDetail,
  getPositionMode,
  getSinglePosition,
  placeOrder,
  setLeverage,
  BitgetError,
  type BitgetCreds,
} from "@/lib/brokers/bitget";
import { getRiskLimits } from "@/lib/brokers/risk-limits";
import {
  estimateLiquidationPrice,
  floorToStep,
  roundAwayFromEntry,
  roundToStep,
  stepDecimals,
  validateStopProfit,
} from "@/lib/brokers/order-math";

export const runtime = "nodejs";

const Body = z.object({
  tradeJournalId: z.string().min(1),
  symbol: z.string().trim().min(3).max(20).regex(/^[A-Z0-9]+$/),
  direction: z.enum(["LONG", "SHORT"]),
  /** Base-coin units (e.g. 0.005 BTC). */
  units: z.number().positive().finite(),
  entryPrice: z.number().positive().finite().optional(),
  orderType: z.enum(["limit", "market"]).default("limit"),
  stopLoss: z.number().positive().finite().optional(),
  takeProfit: z.number().positive().finite().optional(),
  leverage: z.number().int().positive().max(125).default(10),
  marginMode: z.enum(["isolated", "crossed"]).default("isolated"),
  /** User typed "OK" in the confirm dialog. Server double-checks. */
  confirmText: z.string(),
});

type Stage =
  | "validate"
  | "set_leverage"
  | "place_order"
  | "verify_sl";

function fail(
  status: number,
  message: string,
  stage: Stage,
  code?: string,
) {
  return NextResponse.json(
    { ok: false, error: { message, code: code ?? null, stage } },
    { status },
  );
}

export async function POST(req: Request) {
  // 0. Kill-switch.
  if (process.env.BITGET_AUTOPLACE_ENABLED !== "true") {
    return fail(
      503,
      "Tính năng đặt lệnh thật đang tạm dừng (kill-switch).",
      "validate",
    );
  }

  // 1. Auth.
  const session = await auth();
  if (!session?.user?.id) {
    return fail(401, "Chưa đăng nhập", "validate");
  }
  const userId = session.user.id;

  // 2. Parse body.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "JSON không hợp lệ", "validate");
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return fail(
      400,
      parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
      "validate",
    );
  }
  const input = parsed.data;

  // 2a. Confirm text must match.
  if (input.confirmText.trim().toUpperCase() !== "OK") {
    return fail(
      400,
      'Phải gõ "OK" trong hộp xác nhận để đặt lệnh thật.',
      "validate",
    );
  }

  // 3. Rate limit (cheap, before any Bitget call).
  if (!rateLimit(`broker-order:${userId}`, 20, 60_000)) {
    return fail(
      429,
      "Quá nhiều lệnh trong 1 phút. Đợi rồi thử lại.",
      "validate",
    );
  }
  if (!rateLimit(`broker-order-tj:${input.tradeJournalId}`, 5, 60_000)) {
    return fail(
      429,
      "Đã thử quá nhiều lần cho lệnh này. Kiểm tra trên Bitget trước khi thử lại.",
      "validate",
    );
  }

  // 4. Journal row must exist and belong to the user.
  const journal = await db.tradeJournal.findFirst({
    where: { id: input.tradeJournalId, userId },
    select: { id: true, market: true, direction: true, symbol: true },
  });
  if (!journal) {
    return fail(404, "Không tìm thấy lệnh trong nhật ký.", "validate");
  }
  if (journal.market !== "CRYPTO") {
    return fail(
      400,
      "Đặt lệnh thật chỉ hỗ trợ thị trường CRYPTO trong giai đoạn này.",
      "validate",
    );
  }

  // 5. Idempotency: pick next attempt number, reserve via unique index.
  const prior = await db.brokerOrder.findMany({
    where: { tradeJournalId: input.tradeJournalId, broker: "BITGET" },
    orderBy: { attempt: "desc" },
    take: 1,
  });
  const lastAttempt = prior[0]?.attempt ?? 0;
  // Block re-fire against ANY non-terminal or already-live order. PENDING
  // means a concurrent request is mid-flight (double-click / retry race);
  // PLACED/PLACED_NO_SL mean the limit order is live; FILLED means a real
  // position already exists. Only FAILED / CANCELLED / UNKNOWN may retry.
  // (For the truly-simultaneous "both read empty" case, both compute
  // attempt=1 → identical clientOid → the @@unique([broker,clientOid])
  // insert below rejects the loser with P2002, which we catch as 409.)
  if (
    prior[0] &&
    (prior[0].status === "PENDING" ||
      prior[0].status === "PLACED" ||
      prior[0].status === "PLACED_NO_SL" ||
      prior[0].status === "FILLED")
  ) {
    const msg =
      prior[0].status === "PENDING"
        ? "Đang xử lý một lệnh cho mục nhật ký này. Đợi vài giây rồi kiểm tra lại."
        : prior[0].status === "FILLED"
          ? `Mục này đã có vị thế thật đang mở (orderId ${prior[0].externalOrderId ?? "?"}). Không đặt thêm để tránh nhân đôi rủi ro.`
          : `Lệnh này đã được đặt trước đó (orderId ${prior[0].externalOrderId ?? "?"}). Không đặt lại.`;
    return fail(409, msg, "validate");
  }
  const attempt = lastAttempt + 1;
  const clientOid = `tj_${input.tradeJournalId}_${attempt}`.slice(0, 36);

  // 6. Load creds.
  const creds = await loadCreds<BitgetCreds>(userId, "BITGET");
  if (!creds) {
    return fail(
      404,
      "Chưa kết nối Bitget. Vào Cài đặt → Sàn giao dịch để thêm API key.",
      "validate",
    );
  }

  // 7. Contract spec + position mode (parallel — both required).
  let spec: Awaited<ReturnType<typeof fetchContractSpec>>;
  let posMode: Awaited<ReturnType<typeof getPositionMode>>;
  try {
    [spec, posMode] = await Promise.all([
      fetchContractSpec(input.symbol),
      getPositionMode(creds),
    ]);
  } catch (e) {
    return fail(
      502,
      e instanceof BitgetError
        ? e.toVietnamese()
        : e instanceof Error
          ? e.message
          : "Không tra được thông tin tài khoản Bitget.",
      "validate",
      e instanceof BitgetError ? e.code : undefined,
    );
  }
  if (!spec) {
    return fail(
      404,
      "Cặp không có trên Bitget USDT-Futures hoặc đã ngừng giao dịch.",
      "validate",
    );
  }
  if (spec.symbolStatus !== "normal") {
    return fail(
      409,
      `Cặp đang ở trạng thái ${spec.symbolStatus} trên Bitget — không vào lệnh được.`,
      "validate",
    );
  }
  if (posMode === "hedge_mode") {
    return fail(
      400,
      "Tài khoản đang ở chế độ Hedge — Phase này chỉ hỗ trợ One-way. Chuyển sang One-way trong Bitget để dùng tính năng.",
      "validate",
    );
  }
  if (posMode === "unknown") {
    return fail(
      502,
      "Không xác định được chế độ vị thế Bitget (one-way/hedge).",
      "validate",
    );
  }

  // 8. Normalize size + price.
  const normalizedSize = floorToStep(input.units, spec.sizeMultiplier);
  if (normalizedSize < spec.minTradeNum) {
    return fail(
      400,
      `Khối lượng dưới mức tối thiểu ${spec.minTradeNum} ${spec.baseCoin}.`,
      "validate",
    );
  }
  // A positive reference price is REQUIRED for every order — it's what the
  // notional / min-notional / margin / liq safety checks are computed from.
  // Without it (e.g. a market order with no entryPrice) those checks would
  // all short-circuit to no-ops and let an unsized order through. The UI
  // always sends entryPrice; a caller wanting market execution must still
  // pass the current price as a reference.
  const referencePrice = input.entryPrice ?? 0;
  if (referencePrice <= 0) {
    return fail(
      400,
      "Cần giá tham chiếu (giá vào) để kiểm tra khối lượng và ký quỹ trước khi đặt lệnh.",
      "validate",
    );
  }
  const normalizedPrice = roundToStep(referencePrice, spec.priceEndStep);

  const notional = normalizedSize * normalizedPrice;
  if (notional < spec.minTradeUSDT) {
    return fail(
      400,
      `Giá trị lệnh ${notional.toFixed(2)} USDT dưới mức tối thiểu ${spec.minTradeUSDT} USDT.`,
      "validate",
    );
  }

  // 9. SL / TP normalization + sanity.
  //
  // Round SL/TP AWAY from entry (never nearest) so tick-rounding can't push
  // a stop across the entry and invalidate it, then validate the ROUNDED
  // values — the numbers actually sent to Bitget — not the raw input.
  const direction = input.direction;
  const priceDec = stepDecimals(spec.priceEndStep);
  const slRounded =
    input.stopLoss !== undefined
      ? roundAwayFromEntry(input.stopLoss, normalizedPrice, spec.priceEndStep)
      : undefined;
  const tpRounded =
    input.takeProfit !== undefined
      ? roundAwayFromEntry(input.takeProfit, normalizedPrice, spec.priceEndStep)
      : undefined;

  const validation = validateStopProfit({
    direction,
    entry: normalizedPrice,
    stopLoss: slRounded,
    takeProfit: tpRounded,
  });
  if (!validation.ok) {
    return fail(400, validation.error, "validate");
  }
  const slString =
    slRounded !== undefined ? slRounded.toFixed(priceDec) : undefined;
  const tpString =
    tpRounded !== undefined ? tpRounded.toFixed(priceDec) : undefined;

  // 10. Pre-flight: balance + positions + risk limits (parallel). We need
  //     the existing position BEFORE the margin/liq checks because an open
  //     position forces its leverage on any add — checking margin at the
  //     requested leverage would under-estimate the real margin required.
  //     All open positions are needed for the max-concurrent-positions cap.
  let balance: Awaited<ReturnType<typeof getAccountBalance>>;
  let existing: Awaited<ReturnType<typeof getSinglePosition>>;
  let allPositions: Awaited<ReturnType<typeof getOpenPositions>>;
  let riskLimits: Awaited<ReturnType<typeof getRiskLimits>>;
  try {
    [balance, existing, allPositions, riskLimits] = await Promise.all([
      getAccountBalance(creds),
      getSinglePosition(creds, input.symbol),
      getOpenPositions(creds),
      getRiskLimits(userId),
    ]);
  } catch (e) {
    return fail(
      502,
      e instanceof BitgetError
        ? e.toVietnamese()
        : "Không lấy được số dư / vị thế hiện tại.",
      "validate",
      e instanceof BitgetError ? e.code : undefined,
    );
  }

  // 10a. Risk limit: max concurrent open positions. Adding to an EXISTING
  //      position on the same symbol doesn't increase the count.
  if (!existing.hasPosition && allPositions.length >= riskLimits.maxOpenPositions) {
    return fail(
      400,
      `Đang mở ${allPositions.length}/${riskLimits.maxOpenPositions} vị thế (giới hạn trong Cài đặt). Đóng bớt trước khi mở thêm.`,
      "validate",
    );
  }

  // 10b. Risk limit: risk-per-trade as % of equity. Only enforceable when
  //      an SL exists — distance(entry→SL) × size is the amount lost if the
  //      stop fires. Orders without SL already get a hard warning in the
  //      confirm dialog; they skip this gate but not the margin gate below.
  if (slRounded !== undefined) {
    const equity = balance.equity > 0 ? balance.equity : balance.available;
    const riskUSDT = Math.abs(normalizedPrice - slRounded) * normalizedSize;
    const maxRiskUSDT = (equity * riskLimits.maxRiskPct) / 100;
    if (equity > 0 && riskUSDT > maxRiskUSDT) {
      return fail(
        400,
        `Lệnh này rủi ro ~${riskUSDT.toFixed(2)} USDT (${((riskUSDT / equity) * 100).toFixed(1)}% vốn), vượt giới hạn ${riskLimits.maxRiskPct}%/lệnh (~${maxRiskUSDT.toFixed(2)} USDT). Giảm khối lượng hoặc đưa SL gần hơn.`,
        "validate",
      );
    }
  }

  // Effective leverage = leverage the order will ACTUALLY execute at. If a
  // position is already open we cannot change leverage (Bitget 40914), so
  // the add inherits the existing leverage regardless of what was requested.
  const effectiveLeverage =
    existing.hasPosition && existing.leverage && existing.leverage > 0
      ? existing.leverage
      : input.leverage;

  // 11. Margin gate — computed at the EFFECTIVE leverage.
  const margin = effectiveLeverage > 0 ? notional / effectiveLeverage : notional;
  if (margin > balance.available * 0.95) {
    const note =
      effectiveLeverage !== input.leverage
        ? ` (vị thế hiện tại đang dùng ${effectiveLeverage}x, không phải ${input.leverage}x bạn nhập)`
        : "";
    return fail(
      400,
      `Cần ký quỹ ~${margin.toFixed(2)} USDT, vượt 95% khả dụng (${balance.available.toFixed(2)} USDT)${note}.`,
      "validate",
    );
  }

  // 12. Liq-price sanity vs SL — also at the effective leverage.
  const liq = estimateLiquidationPrice({
    side: direction === "LONG" ? "long" : "short",
    entry: normalizedPrice,
    leverage: effectiveLeverage,
    maintainMarginRate: spec.maintainMarginRate,
    marginMode: input.marginMode,
  });
  if (liq !== null && slRounded !== undefined) {
    const slBeyondLiq =
      direction === "LONG" ? slRounded < liq : slRounded > liq;
    if (slBeyondLiq) {
      return fail(
        400,
        `Stop loss nằm xa hơn giá thanh lý ước tính (~${liq.toFixed(priceDec)}). Vị thế sẽ bị thanh lý trước khi SL chạm — giảm đòn bẩy hoặc đưa SL gần hơn.`,
        "validate",
      );
    }
  }

  // 13. Create the pending BrokerOrder row BEFORE any write call — gives
  //     the unique index on (broker,clientOid) a chance to reject double-fire.
  const sizeString = normalizedSize.toFixed(stepDecimals(spec.sizeMultiplier));
  const priceString =
    input.orderType === "limit"
      ? normalizedPrice.toFixed(stepDecimals(spec.priceEndStep))
      : null;
  const side: "buy" | "sell" = direction === "LONG" ? "buy" : "sell";

  let orderRow;
  try {
    orderRow = await db.brokerOrder.create({
      data: {
        userId,
        tradeJournalId: input.tradeJournalId,
        broker: "BITGET",
        clientOid,
        attempt,
        status: "PENDING",
        symbol: input.symbol,
        side,
        orderType: input.orderType,
        productType: "USDT-FUTURES",
        marginCoin: "USDT",
        marginMode: input.marginMode,
        posMode: posMode,
        leverage: effectiveLeverage,
        size: sizeString,
        price: priceString,
        presetStopLoss: slString ?? null,
        presetTakeProfit: tpString ?? null,
        requestedSize: input.units,
        requestedPrice: input.entryPrice ?? null,
      },
    });
  } catch (e) {
    return fail(
      409,
      "Lệnh đã được tạo song song — không đặt lại.",
      "validate",
      e instanceof Error ? e.name : undefined,
    );
  }

  const finalizeFailure = async (
    stage: Stage,
    code: string | undefined,
    message: string,
    raw?: unknown,
    // FAILED = broker definitively rejected. UNKNOWN = we never got a
    // definitive answer (timeout / socket reset / 5xx after the request may
    // have been accepted) — the order MIGHT be live, so it must stay
    // visible to the reconciler.
    status: "FAILED" | "UNKNOWN" = "FAILED",
  ) => {
    await db.brokerOrder.update({
      where: { id: orderRow.id },
      data: {
        status,
        errorStage: stage,
        errorCode: code ?? null,
        errorMessage: message,
        ...(raw !== undefined ? { rawResponse: raw as object } : {}),
      },
    });
    return fail(502, message, stage, code);
  };

  // 14. setLeverage. When a position is already open we must NOT change
  //     leverage (Bitget rejects with 40914) — the add inherits the
  //     existing leverage, which the margin/liq checks above already used
  //     (effectiveLeverage). Only call setLeverage when there's no open
  //     position, or the requested leverage already matches.
  if (existing.hasPosition && existing.leverage !== input.leverage) {
    await db.brokerOrder.update({
      where: { id: orderRow.id },
      data: {
        errorMessage: `Đã giữ đòn bẩy ${existing.leverage}x của vị thế hiện tại (lệnh nhập ${input.leverage}x).`,
      },
    });
  } else {
    try {
      await setLeverage(creds, {
        symbol: input.symbol,
        leverage: input.leverage,
        marginCoin: "USDT",
        productType: "USDT-FUTURES",
        ...(input.marginMode === "isolated"
          ? { holdSide: direction === "LONG" ? "long" : "short" }
          : {}),
      });
    } catch (e) {
      const code = e instanceof BitgetError ? e.code : undefined;
      const msg =
        e instanceof BitgetError
          ? e.toVietnamese()
          : e instanceof Error
            ? e.message
            : "Không đặt được đòn bẩy.";
      const raw =
        e instanceof BitgetError
          ? { code: e.code, msg: e.bitgetMsg }
          : undefined;
      return finalizeFailure("set_leverage", code, msg, raw);
    }
  }

  // 15. Place the order.
  let placeResult: Awaited<ReturnType<typeof placeOrder>>;
  try {
    placeResult = await placeOrder(creds, {
      symbol: input.symbol,
      productType: "USDT-FUTURES",
      marginCoin: "USDT",
      marginMode: input.marginMode,
      side,
      orderType: input.orderType,
      size: sizeString,
      price: priceString ?? undefined,
      clientOid,
      presetStopLossPrice: slString,
      presetStopSurplusPrice: tpString,
    });
  } catch (e) {
    // A BitgetError means Bitget replied with a business rejection → the
    // order was definitively NOT placed → FAILED. Any other error (fetch
    // timeout via AbortSignal, socket reset, DNS, 5xx) means we never got a
    // definitive answer — the order MAY have been accepted. Mark UNKNOWN so
    // the reconciler re-checks it by clientOid instead of assuming failure.
    const isBusinessReject = e instanceof BitgetError;
    const code = isBusinessReject ? (e as BitgetError).code : undefined;
    const sentBody = {
      symbol: input.symbol,
      side,
      size: sizeString,
      price: priceString,
      orderType: input.orderType,
      marginMode: input.marginMode,
      presetStopLossPrice: slString,
      presetStopSurplusPrice: tpString,
      leverage: effectiveLeverage,
    };
    if (isBusinessReject) {
      const msg = (e as BitgetError).toVietnamese();
      return finalizeFailure("place_order", code, msg, {
        code: (e as BitgetError).code,
        msg: (e as BitgetError).bitgetMsg,
        sentBody,
      });
    }
    // Ambiguous outcome.
    const msg =
      e instanceof Error && e.name === "TimeoutError"
        ? "Bitget không phản hồi kịp — lệnh CÓ THỂ đã vào. Kiểm tra app Bitget; hệ thống sẽ tự đối soát."
        : e instanceof Error
          ? `Lỗi mạng khi đặt lệnh: ${e.message}. Lệnh có thể đã vào — hệ thống sẽ tự đối soát.`
          : "Lỗi không xác định khi đặt lệnh — hệ thống sẽ tự đối soát.";
    return finalizeFailure(
      "place_order",
      code,
      msg,
      { networkError: true, sentBody },
      "UNKNOWN",
    );
  }

  // 16. Verify SL actually registered (best-effort).
  let slVerified: boolean | null = null;
  let detail: Awaited<ReturnType<typeof getOrderDetail>> = null;
  if (slString) {
    try {
      detail = await getOrderDetail(creds, {
        symbol: input.symbol,
        orderId: placeResult.result.orderId,
      });
      slVerified = !!detail?.presetStopLossPrice;
    } catch {
      slVerified = null; // network blip; flag for reconciliation
    }
  }

  const finalStatus =
    slString && slVerified === false ? "PLACED_NO_SL" : "PLACED";

  await db.brokerOrder.update({
    where: { id: orderRow.id },
    data: {
      status: finalStatus,
      externalOrderId: placeResult.result.orderId,
      rawResponse: placeResult.raw as object,
      errorStage: finalStatus === "PLACED_NO_SL" ? "verify_sl" : null,
      errorMessage:
        finalStatus === "PLACED_NO_SL"
          ? "Lệnh đã vào nhưng Bitget không gắn SL. Đặt SL thủ công trên app Bitget ngay."
          : null,
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      orderId: placeResult.result.orderId,
      clientOid,
      brokerOrderRowId: orderRow.id,
      status: finalStatus,
      normalizedSize: sizeString,
      normalizedPrice: priceString,
      estimatedLiq: liq,
      slVerified,
      warning:
        finalStatus === "PLACED_NO_SL"
          ? "Bitget không xác nhận SL. Kiểm tra app Bitget và đặt SL ngay."
          : null,
    },
  });
}
