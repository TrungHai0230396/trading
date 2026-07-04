/**
 * Deterministic trade-plan generator. Pure function — no I/O, no AI.
 *
 * Why pure code, not AI?
 * Numbers (entry, SL, TP, leverage, margin) MUST be deterministic and
 * grounded in real market structure (ATR + recent swings). Refreshing
 * a page should not change them. The AI's job is to explain WHY this
 * plan makes sense, not to make up numbers.
 *
 * SL rule, post-critique:
 *   atrSL       = entry ± 1.5×ATR              (volatility floor)
 *   structureSL = swingLow ± 0.25×ATR          (just outside structure)
 *   SL          = TIGHTER of the two           (more capital-efficient
 *                                              while still respecting
 *                                              structure)
 *
 *   sanity caps:
 *     SL distance / entry must be in [0.3%, 8%].
 *     If clipped, warning is pushed.
 *
 *   liquidation check:
 *     liqDistance ≈ entry / leverage. If liq is within 1.5× of SL
 *     distance from entry → warning "liq quá gần SL".
 *
 *   fee model:
 *     Round-trip Binance perp taker ≈ 0.08% of notional. Warn if fees
 *     would exceed 20% of risk amount (setup is uneconomical).
 */

import type { Verdict } from "./recommendation";

export type TradePlanInput = {
  symbol: string;
  base: string;
  /** "LONG" | "SHORT" — derived by caller from recommendation verdict.
   *  Caller MUST NOT call this function when verdict === "WAIT". */
  direction: "LONG" | "SHORT";
  lastPrice: number;
  /** ATR(14) on the timeframe used for the SL. */
  atr: number;
  /** Recent swing low/high used as structure reference. Either may be null
   *  if not enough data; falls back to ATR-only SL with a warning. */
  swingLow: number | null;
  swingHigh: number | null;
  /** Account balance in account currency (≈ USDT for crypto futures). */
  accountBalance: number;
  /** Risk percent of balance, e.g. 0.01 = 1%. */
  riskPercent: number;
};

export type TradePlan = {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  slPrice: number;
  /** |entry-sl| / entry, as a decimal (0.025 = 2.5%). */
  slPct: number;
  atrMultiple: number; // how many ATRs the SL is from entry
  tp1Price: number;
  tp2Price: number;
  rr1: number; // always 1
  rr2: number; // always 2
  /** Position size in base asset (e.g. BTC). */
  units: number;
  /** Notional in quote currency (entry × units, ≈ USDT). */
  notional: number;
  /** Risk in account currency = balance × riskPercent. */
  riskAmount: number;
  /** Smallest leverage that lets the position fit at all (notional / balance, rounded up). */
  leverageRequired: number;
  /** Estimated liquidation price assuming isolated, zero maintenance margin. */
  liquidationPrice: number;
  /** Margin (account currency) sàn will lock = notional / leverageRequired. */
  margin: number;
  /** Round-trip taker fee estimate in account currency. */
  expectedFees: number;
  /** Fees as % of riskAmount. */
  feesPctOfR: number;
  warnings: string[];
};

const MIN_SL_PCT = 0.003; // 0.3% — below this, fees + spread eat R
const MAX_SL_PCT = 0.08; // 8% — above this, scale of risk dwarfs daily noise
const FEE_PER_SIDE = 0.0004; // 4 bps Binance taker
const FEE_RT = FEE_PER_SIDE * 2; // round trip

export function computeTradePlan(input: TradePlanInput): TradePlan {
  const warnings: string[] = [];
  const isLong = input.direction === "LONG";
  const entry = input.lastPrice;
  const atr = Number.isFinite(input.atr) && input.atr > 0 ? input.atr : 0;

  // Build candidate SLs.
  const atrSL = isLong ? entry - 1.5 * atr : entry + 1.5 * atr;
  const structRef = isLong ? input.swingLow : input.swingHigh;
  let slPrice: number;
  if (structRef !== null && atr > 0) {
    const structSL = isLong
      ? structRef - 0.25 * atr
      : structRef + 0.25 * atr;
    // TIGHTER of the two = closer to entry. For LONG, that's the higher SL.
    // For SHORT, the lower SL. Use semantic "between" to be unambiguous.
    slPrice = isLong
      ? Math.max(atrSL, structSL)
      : Math.min(atrSL, structSL);
  } else if (atr > 0) {
    slPrice = atrSL;
    warnings.push(
      "Không đủ dữ liệu swing — SL dựa hoàn toàn vào ATR(14), không có neo cấu trúc",
    );
  } else {
    // ATR unavailable — last-ditch fallback: 2% from entry.
    slPrice = isLong ? entry * 0.98 : entry * 1.02;
    warnings.push(
      "ATR không khả dụng — SL dùng giá trị mặc định 2%",
    );
  }

  let slDistance = Math.abs(entry - slPrice);
  let slPct = slDistance / entry;

  // Apply sanity caps.
  if (slPct < MIN_SL_PCT) {
    slPct = MIN_SL_PCT;
    slDistance = entry * slPct;
    slPrice = isLong ? entry - slDistance : entry + slDistance;
    warnings.push(
      `SL quá hẹp — đã nới về ${(MIN_SL_PCT * 100).toFixed(1)}% để chừa phí & spread`,
    );
  } else if (slPct > MAX_SL_PCT) {
    slPct = MAX_SL_PCT;
    slDistance = entry * slPct;
    slPrice = isLong ? entry - slDistance : entry + slDistance;
    warnings.push(
      `SL quá rộng — đã giới hạn ở ${(MAX_SL_PCT * 100).toFixed(0)}%; cân nhắc chờ pullback hoặc giảm risk`,
    );
  }

  const atrMultiple = atr > 0 ? slDistance / atr : 0;

  // TPs: 1R and 2R, no structure constraint here — caller can show extra
  // "near resistance/support" levels separately.
  const tp1Price = isLong ? entry + slDistance : entry - slDistance;
  const tp2Price = isLong ? entry + 2 * slDistance : entry - 2 * slDistance;

  // Position sizing from risk budget.
  const riskAmount = input.accountBalance * input.riskPercent;
  const units = riskAmount / slDistance;
  const notional = units * entry;

  // Leverage = how many times balance the position is worth. Always
  // round UP because exchanges only let you set integer leverages.
  const leverageRequired = Math.max(
    1,
    Math.ceil(notional / Math.max(input.accountBalance, 1)),
  );
  const margin = notional / leverageRequired;

  // Approximate isolated-margin liquidation (zero maintenance margin):
  //   LONG : liq = entry × (1 − 1/leverage)
  //   SHORT: liq = entry × (1 + 1/leverage)
  const liquidationPrice = isLong
    ? entry * (1 - 1 / leverageRequired)
    : entry * (1 + 1 / leverageRequired);
  const liqDistance = Math.abs(entry - liquidationPrice);
  if (liqDistance < slDistance * 1.5) {
    warnings.push(
      "Giá thanh lý quá gần SL — tăng vốn hoặc giảm rủi ro để có buffer",
    );
  }

  const expectedFees = notional * FEE_RT;
  const feesPctOfR = (expectedFees / riskAmount) * 100;
  if (feesPctOfR > 20) {
    warnings.push(
      `Phí ước tính ${feesPctOfR.toFixed(0)}% của R — setup không kinh tế, cân nhắc bỏ qua`,
    );
  }

  return {
    direction: input.direction,
    entryPrice: round(entry, 2),
    slPrice: round(slPrice, priceDp(entry)),
    slPct: round(slPct * 100, 2),
    atrMultiple: round(atrMultiple, 2),
    tp1Price: round(tp1Price, priceDp(entry)),
    tp2Price: round(tp2Price, priceDp(entry)),
    rr1: 1,
    rr2: 2,
    units: round(units, 6),
    notional: round(notional, 2),
    riskAmount: round(riskAmount, 2),
    leverageRequired,
    liquidationPrice: round(liquidationPrice, priceDp(entry)),
    margin: round(margin, 2),
    expectedFees: round(expectedFees, 2),
    feesPctOfR: round(feesPctOfR, 1),
    warnings,
  };
}

/** Compact plan-copy string the user can paste anywhere. NOT a Binance
 *  order — it's a human plan summary. */
export function planToText(plan: TradePlan, symbol: string, base: string): string {
  return [
    `${symbol} ${plan.direction}`,
    `Entry market @ ${plan.entryPrice}`,
    `SL ${plan.slPrice} (-${plan.slPct.toFixed(2)}%)`,
    `TP1 ${plan.tp1Price} (1R) / TP2 ${plan.tp2Price} (2R)`,
    `Size ${plan.units} ${base} | Margin ${plan.margin} USDT (${plan.leverageRequired}× iso)`,
    `Risk ${plan.riskAmount} USDT`,
  ].join("\n");
}

// ── helpers ──────────────────────────────────────────────────────────

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Number of decimal places to use for a price, scaling with magnitude. */
function priceDp(price: number): number {
  const abs = Math.abs(price);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  if (abs >= 0.01) return 6;
  return 8;
}

/** Map recommendation verdict → trade direction. WAIT throws (caller's bug). */
export function verdictToDirection(v: Verdict): "LONG" | "SHORT" {
  if (v === "ENTER_LONG") return "LONG";
  if (v === "ENTER_SHORT") return "SHORT";
  throw new Error("Cannot build trade plan for WAIT verdict");
}
