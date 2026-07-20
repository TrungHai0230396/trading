/**
 * Setup history ("backtest-lite") + signal age — pure array math over 4h
 * bars, no AI, no extra API shape.
 *
 * Replays the app's own signal (EMA9 vs WMA45 on RSI14) across ~1000 4h
 * bars (~5-6 months) and answers two questions the live page can't:
 *
 *  1. SIGNAL AGE — how long ago did the 4h signal flip to the current
 *     side, and how far has price run since? (A fresh flip and a 3-week-old
 *     one are opposite trades.)
 *
 *  2. OCCURRENCES — each historical flip INTO the current side is treated
 *     as if the user took the page's own plan (SL = tighter of 1.5×ATR /
 *     swing±0.25×ATR, capped 0.3–8%; TP1 = 1R) and we record whether TP1
 *     or SL was hit first, plus the 7-day close-to-close return.
 *
 * Honest labeling matters: this replays the 4h signal component, NOT the
 * full 4-timeframe consensus (aligning 4 TF series is a later upgrade).
 * The UI must say "tín hiệu 4h" — not oversell it.
 *
 * Results are cached in-process per (symbol, side, UTC day): history
 * barely moves intraday and the input fetch is ~1 Binance call.
 */

import { rsi } from "@/lib/indicators/rsi";
import { ema } from "@/lib/indicators/ema";
import { wma } from "@/lib/indicators/wma";
import type { OHLCVBar } from "@/lib/scanner/ohlcv";

export type SetupOutcome = "tp1" | "sl" | "open";

export type SetupHistory = {
  timeframe: "4h";
  lookbackBars: number;
  lookbackDays: number;
  /** Historical flips into the current side (excluding the live one). */
  occurrences: number;
  tp1First: number;
  slFirst: number;
  /** Flips whose trade hadn't resolved by the end of data. */
  unresolved: number;
  /** Median close-to-close % return 7 days (42 bars) after each flip. */
  medianReturn7dPct: number | null;
};

export type SignalAge = {
  timeframe: "4h";
  /** Bars since the signal flipped to the current side. */
  bars: number;
  /** ISO time of the flip bar. */
  since: string;
  /** % price change from the flip bar's close to the latest close. */
  priceChangePct: number;
  /** True when no flip was found inside the window (age ≥ window). */
  exhausted: boolean;
};

const RSI_PERIOD = 14;
const EMA_PERIOD = 9;
const WMA_PERIOD = 45;
// Ignore signals before indicators have warmed up.
const WARMUP = RSI_PERIOD + WMA_PERIOD + 10;
const SEVEN_DAYS_IN_4H_BARS = 42;

/** Signed signal series: +1 BULL, −1 BEAR, 0 neutral/unknown. */
function signalSeries(closes: number[]): number[] {
  const r = rsi(closes, RSI_PERIOD);
  const e = ema(r, EMA_PERIOD);
  const w = wma(r, WMA_PERIOD);
  return closes.map((_, i) => {
    const ei = e[i];
    const wi = w[i];
    if (!Number.isFinite(ei) || !Number.isFinite(wi)) return 0;
    if (ei > wi) return 1;
    if (ei < wi) return -1;
    return 0;
  });
}

/** Wilder ATR series aligned with bars (NaN during warmup). */
function atrSeries(bars: OHLCVBar[], period = 14): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length < period + 1) return out;
  const tr = (i: number) =>
    Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    );
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  out[period] = sum / period;
  for (let i = period + 1; i < bars.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr(i)) / period;
  }
  return out;
}

/** The page's SL rule, replayed at bar i. Returns SL distance (abs). */
function slDistanceAt(
  bars: OHLCVBar[],
  atr: number[],
  i: number,
  isLong: boolean,
): number | null {
  const entry = bars[i].c;
  const a = atr[i];
  if (!Number.isFinite(a) || a <= 0) return null;

  const atrSL = isLong ? entry - 1.5 * a : entry + 1.5 * a;
  const from = Math.max(0, i - 30);
  let structRef: number | null = null;
  for (let j = from; j <= i; j++) {
    const v = isLong ? bars[j].l : bars[j].h;
    structRef =
      structRef === null
        ? v
        : isLong
          ? Math.min(structRef, v)
          : Math.max(structRef, v);
  }
  let sl = atrSL;
  if (structRef !== null) {
    const structSL = isLong ? structRef - 0.25 * a : structRef + 0.25 * a;
    sl = isLong ? Math.max(atrSL, structSL) : Math.min(atrSL, structSL);
  }
  let pct = Math.abs(entry - sl) / entry;
  pct = Math.min(Math.max(pct, 0.003), 0.08);
  return entry * pct;
}

export function computeSignalAge(
  bars: OHLCVBar[],
  side: "LONG" | "SHORT",
): SignalAge | null {
  if (bars.length < WARMUP + 2) return null;
  const closes = bars.map((b) => b.c);
  const sig = signalSeries(closes);
  const want = side === "LONG" ? 1 : -1;
  const last = bars.length - 1;
  if (sig[last] !== want) return null; // page side disagrees — skip

  let flip = -1;
  for (let i = last; i >= WARMUP; i--) {
    if (sig[i] !== want) {
      flip = i + 1;
      break;
    }
  }
  const exhausted = flip === -1;
  const flipIdx = exhausted ? WARMUP : flip;
  const barsSince = last - flipIdx;
  const changePct =
    ((closes[last] - closes[flipIdx]) / closes[flipIdx]) * 100;
  return {
    timeframe: "4h",
    bars: barsSince,
    since: new Date(bars[flipIdx].t).toISOString(),
    priceChangePct: Math.round(changePct * 100) / 100,
    exhausted,
  };
}

export function computeSetupHistory(
  bars: OHLCVBar[],
  side: "LONG" | "SHORT",
): SetupHistory | null {
  if (bars.length < WARMUP + SEVEN_DAYS_IN_4H_BARS) return null;
  const closes = bars.map((b) => b.c);
  const sig = signalSeries(closes);
  const atr = atrSeries(bars, 14);
  const want = side === "LONG" ? 1 : -1;
  const isLong = side === "LONG";
  const last = bars.length - 1;

  let occurrences = 0;
  let tp1First = 0;
  let slFirst = 0;
  let unresolved = 0;
  const returns7d: number[] = [];

  for (let i = WARMUP + 1; i < last; i++) {
    // Flip INTO the wanted side. Exclude the still-live flip (it has no
    // outcome yet and would double-count what signal-age already shows).
    if (sig[i] !== want || sig[i - 1] === want) continue;

    occurrences++;
    const entry = closes[i];
    const dist = slDistanceAt(bars, atr, i, isLong);

    if (dist !== null) {
      const slLevel = isLong ? entry - dist : entry + dist;
      const tp1Level = isLong ? entry + dist : entry - dist;
      let outcome: SetupOutcome = "open";
      for (let j = i + 1; j <= last; j++) {
        const hitSL = isLong ? bars[j].l <= slLevel : bars[j].h >= slLevel;
        const hitTP = isLong ? bars[j].h >= tp1Level : bars[j].l <= tp1Level;
        // Same-bar ambiguity → count as SL (conservative).
        if (hitSL) {
          outcome = "sl";
          break;
        }
        if (hitTP) {
          outcome = "tp1";
          break;
        }
      }
      if (outcome === "tp1") tp1First++;
      else if (outcome === "sl") slFirst++;
      else unresolved++;
    } else {
      unresolved++;
    }

    const j7 = i + SEVEN_DAYS_IN_4H_BARS;
    if (j7 <= last) {
      returns7d.push(((closes[j7] - entry) / entry) * 100);
    }
  }

  let medianReturn7dPct: number | null = null;
  if (returns7d.length > 0) {
    const sorted = [...returns7d].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    medianReturn7dPct = Math.round(median * 100) / 100;
  }

  return {
    timeframe: "4h",
    lookbackBars: bars.length,
    lookbackDays: Math.round((bars.length * 4) / 24),
    occurrences,
    tp1First,
    slFirst,
    unresolved,
    medianReturn7dPct,
  };
}

// ── In-process day cache ────────────────────────────────────────────────

type HistoryEntry = { day: string; data: SetupHistory | null };
const historyCache = new Map<string, HistoryEntry>();

export function cachedSetupHistory(
  symbol: string,
  side: "LONG" | "SHORT",
  bars: OHLCVBar[],
): SetupHistory | null {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${symbol}:${side}`;
  const hit = historyCache.get(key);
  if (hit && hit.day === day) return hit.data;
  const data = computeSetupHistory(bars, side);
  historyCache.set(key, { day, data });
  if (historyCache.size > 500) {
    for (const [k, v] of historyCache) {
      if (v.day !== day) historyCache.delete(k);
    }
  }
  return data;
}
