/**
 * Gemini narrative generator for the symbol deep-dive page.
 *
 * Design decision (post-critique):
 *   The recommendation verdict + numeric trade plan are computed
 *   DETERMINISTICALLY in code (see lib/analysis/recommendation.ts and
 *   trade-plan.ts). This file only asks Gemini for the QUALITATIVE
 *   narrative: a Vietnamese explanation grounded in the data, plus
 *   trigger/exit/invalidation conditions, plus 2-4 things to watch.
 *
 * Why?
 *   - Two users on the same data must see the same verdict.
 *   - LLMs at temperature 0.4 are bad at deterministic decision trees.
 *   - Smaller schema = cheaper + faster + easier to validate.
 *
 * Anti-platitude rule:
 *   System prompt explicitly forbids vague phrases ("có thể tăng",
 *   "đáng theo dõi") and requires every sentence to cite a concrete
 *   number from the snapshot.
 */

import { z } from "zod";
import {
  callGeminiJson,
  extractJson,
  GeminiError,
} from "@/lib/ai/gemini";
import type { AnalysisSnapshot } from "@/lib/analysis/snapshot";

export type SymbolNarrative = {
  narrative: string;
  entryWhen: string;
  exitWhen: string;
  invalidation: string;
  watchPoints: string[];
  aiModel: string;
  generatedAt: string;
};

const NarrativeSchema = z.object({
  narrative: z.string().trim().min(40).max(800),
  entryWhen: z.string().trim().min(10).max(220),
  exitWhen: z.string().trim().min(10).max(220),
  invalidation: z.string().trim().min(10).max(220),
  watchPoints: z.array(z.string().trim().min(4).max(160)).min(2).max(5),
});

const SYSTEM = `Bạn là trader chuyên nghiệp 10 năm kinh nghiệm phân tích đa khung & quản trị rủi ro. Trả lời TIẾNG VIỆT, NGẮN GỌN, DỨT KHOÁT. Giữ thuật ngữ tiếng Anh (RSI, EMA, ATR, support, resistance, breakout, retest, funding...).

QUAN TRỌNG:
- KHÔNG đưa khuyến nghị đầu tư.
- KHÔNG đề xuất hành động ("nên mua", "nên bán") — quyết định đã được code tính sẵn.
- Mọi câu PHẢI gắn với SỐ CỤ THỂ từ dữ liệu (giá, RSI, % thay đổi, kháng cự/hỗ trợ, ATR).
- CẤM cụm từ vô nghĩa: "có thể tăng", "đáng theo dõi", "cần quan sát thêm", "thận trọng", "tiềm năng".

Mỗi câu chốt phải có ít nhất 1 con số. Nếu không có số liên quan, hãy bỏ câu đó.

Schema JSON output (BẮT BUỘC):
{
  "narrative": string,           // 3-5 câu — giải thích tại sao đồng thuận và momentum như hiện tại
  "entryWhen": string,           // 1-2 câu — điều kiện cụ thể để vào lệnh (giá, RSI, breakout level)
  "exitWhen": string,            // 1-2 câu — khi nào nên thoát trước khi chạm SL/TP
  "invalidation": string,        // 1-2 câu — dấu hiệu kế hoạch không còn hợp lệ (giá phá hỗ trợ, đảo chiều RSI)
  "watchPoints": string[]        // 2-4 mục, mỗi mục ≤ 160 ký tự — sự kiện/level cần theo dõi 24-72h
}

CHỈ trả về JSON, KHÔNG markdown, KHÔNG \`\`\`.`;

export async function runSymbolAnalysis(
  snap: AnalysisSnapshot,
): Promise<SymbolNarrative> {
  const prompt = buildUserPrompt(snap);
  const { raw, modelId } = await callGeminiJson({
    systemInstruction: SYSTEM,
    prompt,
    temperature: 0.4,
  });

  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new GeminiError("Phân tích AI trả về JSON không hợp lệ");
  }
  const validated = NarrativeSchema.safeParse(parsed);
  if (!validated.success) {
    throw new GeminiError(
      `Phân tích AI sai schema: ${validated.error.issues[0]?.message ?? "unknown"}`,
    );
  }

  return {
    ...validated.data,
    aiModel: modelId,
    generatedAt: new Date().toISOString(),
  };
}

function buildUserPrompt(s: AnalysisSnapshot): string {
  const lines: string[] = [];
  lines.push(`Mã: ${s.symbol} (${s.market})`);
  lines.push(`Giá hiện tại: ${fmt(s.price.last)}`);
  if (s.price.change24hPct !== null) {
    lines.push(`Thay đổi 24h: ${s.price.change24hPct.toFixed(2)}%`);
  }
  if (s.price.high24h !== null && s.price.low24h !== null) {
    lines.push(
      `High/Low 24h: ${fmt(s.price.high24h)} / ${fmt(s.price.low24h)}`,
    );
  }
  lines.push("");

  lines.push(
    `Đồng thuận đa khung: ${s.consensus.alignment} (${s.consensus.score.toFixed(
      0,
    )}/100)`,
  );
  for (const tf of s.perTF) {
    const strat = tf.perStrategy.find((p) => p.strategy === "ema-wma-on-rsi");
    if (strat) {
      const ind = strat.indicators;
      lines.push(
        `- ${tf.timeframe}: ${tf.signal} | RSI ${fmtNum(ind.rsi)} · EMA(RSI) ${fmtNum(ind.emaOnRsi)} · WMA(RSI) ${fmtNum(ind.wmaOnRsi)}`,
      );
    }
  }
  lines.push("");

  if (s.atrValue !== null) {
    lines.push(
      `ATR(14) trên khung ${s.atrTimeframe}: ${fmt(s.atrValue)}`,
    );
  }
  if (s.swingLow !== null && s.swingHigh !== null) {
    lines.push(
      `Swing 30 nến gần nhất: low ${fmt(s.swingLow)}, high ${fmt(s.swingHigh)}`,
    );
  }
  if (s.nearestResistance.length > 0) {
    lines.push(
      `Kháng cự gần nhất: ${s.nearestResistance
        .map((r) => fmt(r.price))
        .join(", ")}`,
    );
  }
  if (s.nearestSupport.length > 0) {
    lines.push(
      `Hỗ trợ gần nhất: ${s.nearestSupport
        .map((r) => fmt(r.price))
        .join(", ")}`,
    );
  }
  lines.push("");

  if (s.volume) {
    lines.push(
      `Khối lượng 24h: ${fmtMillions(s.volume.last24h)} USDT · TB 20 ngày: ${fmtMillions(s.volume.avg20d)} USDT · Tỉ lệ: ${s.volume.ratio.toFixed(2)}× (${s.volume.classification})`,
    );
    lines.push("");
  }

  // Recommendation context (deterministic — fed in so AI's narrative
  // explains the verdict instead of contradicting it).
  lines.push(
    `Đánh giá đã tính (KHÔNG được mâu thuẫn): ${s.recommendation.verdict} (${s.recommendation.confidence})`,
  );
  if (s.recommendation.reasons.length > 0) {
    lines.push(`Lý do code đưa ra: ${s.recommendation.reasons.join("; ")}`);
  }
  lines.push("");

  // Trade plan numbers — AI explains them, doesn't invent.
  if (s.tradePlan) {
    const p = s.tradePlan;
    lines.push(
      `Kế hoạch đã tính: ${p.direction} entry ${fmt(p.entryPrice)} · SL ${fmt(p.slPrice)} (${p.slPct.toFixed(2)}%, ${p.atrMultiple.toFixed(2)}×ATR) · TP1 ${fmt(p.tp1Price)} (1R) · TP2 ${fmt(p.tp2Price)} (2R) · Leverage ${p.leverageRequired}× · Margin ${p.margin} USDT · Risk ${p.riskAmount} USDT`,
    );
    if (p.warnings.length > 0) {
      lines.push(`Cảnh báo plan: ${p.warnings.join("; ")}`);
    }
    lines.push("");
  } else {
    lines.push(
      `Chưa có kế hoạch giao dịch (verdict = WAIT). AI giải thích vì sao chờ + điều kiện vào lệnh.`,
    );
    lines.push("");
  }

  // News block — title + sentiment + source. No body to avoid prompt
  // injection from arbitrary article text.
  if (s.news.length > 0) {
    lines.push(`Tin tức gần đây (${s.news.length}):`);
    for (const n of s.news.slice(0, 8)) {
      const sentiment = n.sentiment ? `(${n.sentiment})` : "";
      lines.push(`- [${n.source}] ${sanitize(n.title)} ${sentiment}`);
    }
  } else {
    lines.push("Tin tức gần đây: không có.");
  }

  return lines.join("\n");
}

// ── helpers ──────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

function fmtNum(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtMillions(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(0);
}

function sanitize(text: string): string {
  // Strip control chars (0x00-0x1F) and curly braces — defense against
  // prompt-injection from arbitrary news titles.
  let out = "";
  for (let i = 0; i < text.length && out.length < 200; i++) {
    const c = text.charCodeAt(i);
    if (c < 32) continue;
    if (c === 0x7b || c === 0x7d) continue; // { }
    out += text[i];
  }
  return out;
}
