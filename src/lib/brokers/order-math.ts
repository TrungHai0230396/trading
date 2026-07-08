/**
 * Pure math helpers for broker order placement. Shared between server
 * (route handler) and client (confirm dialog preview). No secrets, no
 * DB, no fetch — safe to import from either side.
 *
 * All input strings are parsed once; we re-stringify with controlled
 * precision based on the contract's sizeMultiplier / priceEndStep so the
 * value we send to Bitget matches its exchange-side rounding rules.
 */

/**
 * Round value DOWN to nearest multiple of `step`. Used for size (never
 * round up — we don't want to send more than the user authorized) and
 * for price on limit orders (so the price is valid on the order book).
 */
/**
 * value/step, corrected for binary-float drift before the caller floors/
 * ceils it. Without this, an EXACT multiple like 8.2/0.1 evaluates to
 * 81.99999999999999, and Math.floor drops a whole step → the user's 8.2
 * becomes 8.1. Rounding the quotient to 9 decimals collapses that drift
 * without affecting genuinely fractional quotients.
 */
function quotient(value: number, step: number): number {
  return Number((value / step).toFixed(9));
}

export function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const n = Math.floor(quotient(value, step)) * step;
  // Re-snap to step's decimals to kill multiplication drift.
  return Number(n.toFixed(stepDecimals(step)));
}

/**
 * Round value to NEAREST step. Use for entry price where slight over/under
 * is fine but value must be valid on the price grid.
 */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const n = Math.round(quotient(value, step)) * step;
  return Number(n.toFixed(stepDecimals(step)));
}

/** Round value UP to nearest multiple of `step`. */
export function ceilToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const n = Math.ceil(quotient(value, step)) * step;
  return Number(n.toFixed(stepDecimals(step)));
}

/**
 * Round a stop-loss / take-profit price to the tick grid such that it
 * moves AWAY from the entry, never across it.
 *
 * Nearest-rounding (roundToStep) is wrong for SL/TP near entry: a LONG
 * stop one tick below entry can round UP to == entry, which Bitget then
 * rejects (or the stop sits on the wrong side and never protects). By
 * always rounding away from entry we guarantee the price stays on its
 * correct side of the grid:
 *
 *   price < entry (LONG SL, SHORT TP)  → floor (further below)
 *   price > entry (LONG TP, SHORT SL)  → ceil  (further above)
 *   price == entry                     → keep as-is (caller validates)
 */
export function roundAwayFromEntry(
  price: number,
  entry: number,
  step: number,
): number {
  if (price < entry) return floorToStep(price, step);
  if (price > entry) return ceilToStep(price, step);
  return price;
}

/** Number of decimal places implied by a step like 0.001 → 3. */
export function stepDecimals(step: number): number {
  if (step <= 0) return 0;
  const s = step.toString();
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const dot = s.indexOf(".");
  return dot >= 0 ? s.length - dot - 1 : 0;
}

/**
 * Approximate liquidation price for isolated futures.
 *
 *   long:  liq ≈ entry × (1 - 1/lev + mmr)
 *   short: liq ≈ entry × (1 + 1/lev - mmr)
 *
 * Cross-margin liq depends on full equity and is not estimated here.
 */
export function estimateLiquidationPrice(args: {
  side: "long" | "short";
  entry: number;
  leverage: number;
  maintainMarginRate: number; // e.g. 0.005 = 0.5%
  marginMode: "isolated" | "crossed";
}): number | null {
  if (args.marginMode !== "isolated") return null;
  if (args.leverage <= 0 || args.entry <= 0) return null;
  const inv = 1 / args.leverage;
  const factor =
    args.side === "long"
      ? 1 - inv + args.maintainMarginRate
      : 1 + inv - args.maintainMarginRate;
  return args.entry * factor;
}

/**
 * Validate SL/TP signs vs direction. Returns a Vietnamese error message
 * when the prices would never trigger (SL on the wrong side of entry).
 */
export function validateStopProfit(args: {
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss?: number;
  takeProfit?: number;
}): { ok: true } | { ok: false; error: string } {
  if (args.stopLoss !== undefined) {
    if (args.direction === "LONG" && args.stopLoss >= args.entry) {
      return { ok: false, error: "Stop loss phải thấp hơn giá vào cho lệnh LONG." };
    }
    if (args.direction === "SHORT" && args.stopLoss <= args.entry) {
      return { ok: false, error: "Stop loss phải cao hơn giá vào cho lệnh SHORT." };
    }
    // Typo guard: SL more than 50% from entry is almost certainly wrong.
    const distPct = Math.abs(args.stopLoss - args.entry) / args.entry;
    if (distPct > 0.5) {
      return {
        ok: false,
        error: "Stop loss cách giá vào hơn 50% — vui lòng kiểm tra lại.",
      };
    }
  }
  if (args.takeProfit !== undefined) {
    if (args.direction === "LONG" && args.takeProfit <= args.entry) {
      return {
        ok: false,
        error: "Take profit phải cao hơn giá vào cho lệnh LONG.",
      };
    }
    if (args.direction === "SHORT" && args.takeProfit >= args.entry) {
      return {
        ok: false,
        error: "Take profit phải thấp hơn giá vào cho lệnh SHORT.",
      };
    }
  }
  return { ok: true };
}
