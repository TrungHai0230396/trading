/**
 * Google Gemini client — used by the news pipeline to summarize articles
 * into Vietnamese with sentiment / impact / tag classification.
 *
 * Reads `process.env.GEMINI_API_KEY` — throws GeminiError if missing.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

// Google retired the 1.5 family — use 2.5 as fallback when 2.0 is throttled/missing.
export const PRIMARY_MODEL = "gemini-2.5-flash";
export const FALLBACK_MODEL = "gemini-2.0-flash";

export type Sentiment = "bullish" | "bearish" | "neutral";
export type Impact = "high" | "medium" | "low";

export type SummaryResult = {
  summary: string;
  sentiment: Sentiment;
  impact: Impact;
  tags: string[];
  /** Model id actually used (post-fallback). */
  aiModel: string;
};

export type SummarizeInput = {
  title: string;
  source: string;
  url: string;
  body?: string;
};

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new GeminiError("Thiếu GEMINI_API_KEY trong .env");
  }
  return key;
}

let cachedClient: GoogleGenerativeAI | null = null;
function client(): GoogleGenerativeAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenerativeAI(apiKey());
  }
  return cachedClient;
}

const SYSTEM_PROMPT = `Bạn là một biên tập viên tài chính chuyên crypto/macro. Người dùng sẽ gửi một bài tin (tiếng Anh hoặc tiếng Việt). Nhiệm vụ:

1. Tóm tắt bằng TIẾNG VIỆT trong 2-3 câu, ngắn gọn, súc tích, giữ thuật ngữ giao dịch bằng tiếng Anh (vd: "spot ETF", "open interest", "liquidation").
2. Đánh giá sentiment cho thị trường crypto: "bullish" | "bearish" | "neutral".
3. Đánh giá impact (mức ảnh hưởng tới giá): "high" | "medium" | "low".
4. Trích 2-5 tags ngắn (vd: ["BTC","ETF","Fed","macro"]). Ưu tiên ticker và chủ đề.

CHỈ trả về JSON đúng định dạng sau, KHÔNG kèm văn bản giải thích, KHÔNG dùng dấu \`\`\`:
{"summary":"...","sentiment":"bullish|bearish|neutral","impact":"high|medium|low","tags":["..."]}`;

/** Strip ```json fences and any leading/trailing prose; return the JSON slice. */
export function extractJson(raw: string): string {
  let s = raw.trim();
  // Strip ```json or ``` fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  // Find the first balanced JSON object
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return s.slice(start, end + 1);
  }
  return s;
}

function coerceSentiment(v: unknown): Sentiment {
  const s = String(v ?? "").toLowerCase();
  if (s === "bullish" || s === "bearish" || s === "neutral") return s;
  if (s.includes("bull")) return "bullish";
  if (s.includes("bear")) return "bearish";
  return "neutral";
}

function coerceImpact(v: unknown): Impact {
  const s = String(v ?? "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  if (s.includes("high")) return "high";
  if (s.includes("low")) return "low";
  return "medium";
}

function coerceTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => String(t ?? "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 6);
}

function parseModelOutput(raw: string): Omit<SummaryResult, "aiModel"> {
  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Permissive fallback — single-quoted JSON-ish output from the model.
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
  const summary = String(obj.summary ?? "").trim();
  if (!summary) {
    throw new GeminiError("Gemini không trả về tóm tắt");
  }
  return {
    summary,
    sentiment: coerceSentiment(obj.sentiment),
    impact: coerceImpact(obj.impact),
    tags: coerceTags(obj.tags),
  };
}

export function isModelNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    msg.includes("not found") ||
    msg.includes("404") ||
    msg.includes("is not supported") ||
    msg.includes("unsupported")
  );
}

async function callGemini(
  modelId: string,
  prompt: string,
): Promise<string> {
  const model = client().getGenerativeModel({
    model: modelId,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Generic JSON-mode call with primary→fallback model handling. Used by
 * other AI features (e.g. insights) that need their own system prompt.
 * Throws GeminiError on misconfiguration / non-recoverable failures.
 *
 * Returns `{ raw, modelId }` where `modelId` is the model that actually
 * answered (post-fallback).
 */
export async function callGeminiJson(opts: {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
}): Promise<{ raw: string; modelId: string }> {
  const callOnce = async (modelId: string) => {
    const model = client().getGenerativeModel({
      model: modelId,
      systemInstruction: opts.systemInstruction,
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        responseMimeType: "application/json",
      },
    });
    const result = await model.generateContent(opts.prompt);
    return result.response.text();
  };

  let modelId = PRIMARY_MODEL;
  let raw: string;
  try {
    raw = await callOnce(PRIMARY_MODEL);
  } catch (err) {
    if (isModelNotFoundError(err)) {
      modelId = FALLBACK_MODEL;
      raw = await callOnce(FALLBACK_MODEL);
    } else {
      throw err instanceof GeminiError
        ? err
        : new GeminiError(
            err instanceof Error ? err.message : "Gemini lỗi không xác định",
          );
    }
  }
  return { raw, modelId };
}

/** Build the user-prompt block for one article. */
function buildUserPrompt(input: SummarizeInput): string {
  const lines: string[] = [
    `Tiêu đề: ${input.title}`,
    `Nguồn: ${input.source}`,
    `URL: ${input.url}`,
  ];
  if (input.body && input.body.trim().length > 0) {
    // Limit body to ~4000 chars to stay safely within the context window.
    lines.push(`Nội dung: ${input.body.slice(0, 4000)}`);
  }
  return lines.join("\n");
}

/**
 * Summarize a single article into Vietnamese with sentiment/impact/tags.
 * Falls back to gemini-1.5-flash if the primary model id is rejected.
 */
export async function summarizeArticleVi(
  input: SummarizeInput,
): Promise<SummaryResult> {
  const prompt = buildUserPrompt(input);

  let modelId = PRIMARY_MODEL;
  let raw: string;
  try {
    raw = await callGemini(PRIMARY_MODEL, prompt);
  } catch (err) {
    if (isModelNotFoundError(err)) {
      modelId = FALLBACK_MODEL;
      raw = await callGemini(FALLBACK_MODEL, prompt);
    } else {
      throw err instanceof GeminiError
        ? err
        : new GeminiError(
            err instanceof Error ? err.message : "Gemini lỗi không xác định",
          );
    }
  }

  const parsed = parseModelOutput(raw);
  return { ...parsed, aiModel: modelId };
}

export type BatchOk<T> = { ok: true; input: T; result: SummaryResult };
export type BatchErr<T> = { ok: false; input: T; error: string };
export type BatchOutcome<T> = BatchOk<T> | BatchErr<T>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Summarize a batch of articles with bounded concurrency. Per-article failures
 * surface as `{ ok: false, error }` entries — they don't abort the batch.
 *
 * Sleeps ~200ms between batches to be friendly to the rate limit.
 */
export async function summarizeBatch<T extends SummarizeInput>(
  articles: T[],
  options: { concurrency?: number; pauseMs?: number } = {},
): Promise<BatchOutcome<T>[]> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const pauseMs = options.pauseMs ?? 200;

  const out: BatchOutcome<T>[] = [];
  for (let i = 0; i < articles.length; i += concurrency) {
    const slice = articles.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      slice.map((a) => summarizeArticleVi(a)),
    );
    settled.forEach((s, idx) => {
      const input = slice[idx]!;
      if (s.status === "fulfilled") {
        out.push({ ok: true, input, result: s.value });
      } else {
        const err = s.reason;
        out.push({
          ok: false,
          input,
          error:
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : "Gemini lỗi không xác định",
        });
      }
    });
    // Don't sleep after the last batch.
    if (i + concurrency < articles.length && pauseMs > 0) {
      await sleep(pauseMs);
    }
  }
  return out;
}
