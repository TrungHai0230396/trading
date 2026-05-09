/**
 * Per-symbol bullishness scorer that asks Gemini for a 0..100 % chance
 * of an upward 3–7 day move, given:
 *
 *   - the latest price snapshot (last close + 1d/7d % change)
 *   - up to 5 recent AI-summarized news items related to the ticker
 *
 * Returns the parsed JSON + the model id that actually responded
 * (primary or fallback).
 */

import {
  callGeminiJson,
  extractJson,
  GeminiError,
  type Sentiment,
} from "@/lib/ai/gemini";
import type { InsightMarket } from "@/lib/insights/curated";
import type { PriceSnapshot } from "@/lib/insights/snapshot";
import type { RelatedNewsItem } from "@/lib/insights/related-news";

export type InsightDirection = "bullish" | "bearish" | "neutral";
export type InsightConfidence = "low" | "medium" | "high";

export type SymbolInsightResult = {
  bullishPercent: number;
  direction: InsightDirection;
  reasoning: string;
  keyDrivers: string[];
  confidence: InsightConfidence;
  aiModel: string;
};

const SYSTEM_PROMPT = `Bạn là trader analyst chuyên crypto/forex. Dựa trên giá, biến động và tin tức (nếu có), hãy đưa ra dự đoán xu hướng giá ngắn hạn (3–7 ngày).

Quy tắc:
- "bullishPercent" là một số nguyên 0..100 — xác suất giá sẽ TĂNG ròng trong 3–7 ngày tới.
- "direction" là "bullish" nếu bullishPercent ≥ 60, "bearish" nếu ≤ 40, ngược lại "neutral".
- "reasoning" viết bằng tiếng Việt, 2-3 câu, súc tích. Giữ thuật ngữ giao dịch bằng tiếng Anh (ETF, open interest, breakout, momentum...).
- "keyDrivers" là mảng tối đa 4 chuỗi ngắn (≤ 60 ký tự) — yếu tố chính thúc đẩy đánh giá.
- "confidence" = "high" khi có nhiều dữ liệu nhất quán, "low" khi thiếu tin tức hoặc tín hiệu mâu thuẫn.

CHỈ trả về JSON đúng định dạng sau, KHÔNG kèm văn bản giải thích, KHÔNG dùng dấu \`\`\`:
{"bullishPercent":0..100,"direction":"bullish|bearish|neutral","reasoning":"...","keyDrivers":["..."],"confidence":"low|medium|high"}`;

function clampPercent(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function coerceDirection(v: unknown, pct: number): InsightDirection {
  const s = String(v ?? "").toLowerCase();
  if (s === "bullish" || s === "bearish" || s === "neutral") return s;
  if (s.includes("bull")) return "bullish";
  if (s.includes("bear")) return "bearish";
  if (pct >= 60) return "bullish";
  if (pct <= 40) return "bearish";
  return "neutral";
}

function coerceConfidence(v: unknown): InsightConfidence {
  const s = String(v ?? "").toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return "medium";
}

function coerceDrivers(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((d) => String(d ?? "").trim())
    .filter((d) => d.length > 0)
    .slice(0, 4)
    .map((d) => (d.length > 80 ? d.slice(0, 80) : d));
}

function fmtPct(p?: number): string {
  if (p === undefined || !Number.isFinite(p)) return "n/a";
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function fmtNum(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: n >= 100 ? 2 : 6,
  });
}

function buildUserPrompt(args: {
  market: InsightMarket;
  symbol: string;
  snapshot: PriceSnapshot;
  news: RelatedNewsItem[];
}): string {
  const { market, symbol, snapshot, news } = args;
  const lines: string[] = [];
  lines.push(`Thị trường: ${market}`);
  lines.push(`Symbol: ${symbol}`);
  lines.push(`Giá hiện tại: ${fmtNum(snapshot.price)}`);
  lines.push(`Biến động 1 ngày: ${fmtPct(snapshot.changes["1d"])}`);
  lines.push(`Biến động 7 ngày: ${fmtPct(snapshot.changes["7d"])}`);
  if (snapshot.high24h !== undefined) {
    lines.push(`High 24h: ${fmtNum(snapshot.high24h)}`);
  }
  if (snapshot.low24h !== undefined) {
    lines.push(`Low 24h: ${fmtNum(snapshot.low24h)}`);
  }

  if (news.length === 0) {
    lines.push("");
    lines.push("Không có tin tức gần đây liên quan đến symbol này.");
  } else {
    lines.push("");
    lines.push(`Tin tức gần đây (${news.length}):`);
    news.forEach((n, i) => {
      const sentiment = n.sentiment ? ` [${n.sentiment}]` : "";
      const summary = n.summary ? ` — ${n.summary}` : "";
      // Cap each line to keep the prompt small.
      const line = `${i + 1}. ${n.title}${sentiment}${summary}`;
      lines.push(line.length > 360 ? line.slice(0, 360) + "…" : line);
    });
  }

  return lines.join("\n");
}

function parseInsightOutput(raw: string): Omit<SymbolInsightResult, "aiModel"> {
  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    try {
      parsed = JSON.parse(json.replace(/'/g, '"'));
    } catch {
      throw new GeminiError("Gemini trả về dữ liệu không phải JSON");
    }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new GeminiError("Gemini trả về cấu trúc không hợp lệ");
  }
  const obj = parsed as Record<string, unknown>;
  const bullishPercent = clampPercent(obj.bullishPercent);
  const direction = coerceDirection(obj.direction, bullishPercent);
  const reasoning = String(obj.reasoning ?? "").trim();
  if (!reasoning) {
    throw new GeminiError("Gemini không trả về phần reasoning");
  }
  return {
    bullishPercent,
    direction,
    reasoning,
    keyDrivers: coerceDrivers(obj.keyDrivers),
    confidence: coerceConfidence(obj.confidence),
  };
}

export async function analyzeSymbolVi(args: {
  market: InsightMarket;
  symbol: string;
  snapshot: PriceSnapshot;
  news: RelatedNewsItem[];
}): Promise<SymbolInsightResult> {
  const { raw, modelId } = await callGeminiJson({
    systemInstruction: SYSTEM_PROMPT,
    prompt: buildUserPrompt(args),
    temperature: 0.3,
  });
  const parsed = parseInsightOutput(raw);
  return { ...parsed, aiModel: modelId };
}

// Re-export for convenience.
export type { Sentiment };
