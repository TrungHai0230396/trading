/**
 * Deterministic recommendation engine.
 *
 * Why deterministic, not AI?
 * Two users opening the same page on the same coin should see the SAME
 * verdict. An LLM at temperature 0.4 gives non-reproducible "MUA NGAY"
 * vs "ĐỢI TÍN HIỆU" answers, which destroys user trust the first time
 * they refresh and the call flips. The decision tree lives in code;
 * the AI only generates the explanatory narrative around it.
 *
 * The output is also pure data — the caller decides how to render it.
 */

export type Verdict = "ENTER_LONG" | "ENTER_SHORT" | "WAIT";

export type Confidence = "low" | "medium" | "high";

export type RecommendationInput = {
  /** Scanner score 0..100 (50 = neutral, 100 = max bullish). */
  consensusScore: number;
  alignment: "BULLISH" | "BEARISH" | "MIXED";
  /** RSI on the 1h timeframe (current bar). Pass null if unavailable. */
  rsi1h: number | null;
  rsi4h: number | null;
  /** Bullish vs bearish news counts in the recent window. */
  newsBullishCount: number;
  newsBearishCount: number;
  /** Optional volume ratio vs 20-bar avg on 1d. */
  volumeRatio: number | null;
};

export type RecommendationResult = {
  verdict: Verdict;
  confidence: Confidence;
  /** Human-readable Vietnamese reasons, in order of importance. */
  reasons: string[];
};

const STRONG_SCORE = 75; // ≥75 BULL or ≤25 BEAR is "strong"
const RSI_OVERBOUGHT_1H = 78;
const RSI_OVERSOLD_1H = 22;

export function computeRecommendation(
  input: RecommendationInput,
): RecommendationResult {
  const reasons: string[] = [];

  // 1) Consensus filter — without strong direction nothing else matters.
  if (input.alignment === "MIXED") {
    return {
      verdict: "WAIT",
      confidence: "low",
      reasons: ["Đa khung chưa đồng thuận một chiều"],
    };
  }
  const isBullSide = input.alignment === "BULLISH";
  const scoreOk = isBullSide
    ? input.consensusScore >= STRONG_SCORE
    : input.consensusScore <= 100 - STRONG_SCORE;
  if (!scoreOk) {
    reasons.push(
      `Điểm đồng thuận ${input.consensusScore.toFixed(0)}/100 — chưa đủ mạnh`,
    );
    return { verdict: "WAIT", confidence: "low", reasons };
  }

  // 2) RSI 1h extreme = wait for pullback (counter-trend risk).
  if (isBullSide && input.rsi1h !== null && input.rsi1h > RSI_OVERBOUGHT_1H) {
    reasons.push(
      `RSI 1h ${input.rsi1h.toFixed(1)} đã quá mua, chờ pullback ngắn hạn`,
    );
    return { verdict: "WAIT", confidence: "medium", reasons };
  }
  if (
    !isBullSide &&
    input.rsi1h !== null &&
    input.rsi1h < RSI_OVERSOLD_1H
  ) {
    reasons.push(
      `RSI 1h ${input.rsi1h.toFixed(1)} đã quá bán, chờ pullup ngắn hạn`,
    );
    return { verdict: "WAIT", confidence: "medium", reasons };
  }

  // 3) Counter-trend news in window — flag but don't always block.
  const counterNews = isBullSide
    ? input.newsBearishCount
    : input.newsBullishCount;
  if (counterNews >= 2) {
    reasons.push(
      `${counterNews} tin tức ngược chiều trong cửa sổ gần đây — kiểm tra trước khi vào`,
    );
    return { verdict: "WAIT", confidence: "medium", reasons };
  }

  // 4) Strong setup. Confidence depends on volume + score magnitude.
  const verdict: Verdict = isBullSide ? "ENTER_LONG" : "ENTER_SHORT";
  const extreme =
    isBullSide ? input.consensusScore >= 90 : input.consensusScore <= 10;
  const volBoost = input.volumeRatio !== null && input.volumeRatio > 1.5;
  const confidence: Confidence =
    extreme && volBoost ? "high" : extreme || volBoost ? "medium" : "medium";

  reasons.push(
    `Đa khung ${isBullSide ? "BULLISH" : "BEARISH"} ${input.consensusScore.toFixed(0)}/100`,
  );
  if (volBoost && input.volumeRatio !== null) {
    reasons.push(
      `Khối lượng ${input.volumeRatio.toFixed(2)}× trung bình — xác nhận momentum`,
    );
  }

  return { verdict, confidence, reasons };
}

/** Vietnamese label for verdict — used by UI. */
export function verdictLabel(v: Verdict): string {
  if (v === "ENTER_LONG") return "Phía LONG";
  if (v === "ENTER_SHORT") return "Phía SHORT";
  return "Chờ tín hiệu";
}

/** Vietnamese confidence label. */
export function confidenceLabel(c: Confidence): string {
  if (c === "high") return "tự tin cao";
  if (c === "medium") return "tự tin trung bình";
  return "tự tin thấp";
}
