/**
 * Gemini-powered on-chain analyzer.
 *
 * Reads `GEMINI_API_KEY` from env. Builds a JSON-only prompt around the raw
 * explorer snapshot (+ DefiLlama price for tokens) and asks Gemini for a
 * Vietnamese narrative + risk level + insights bullets.
 */

import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import type { ExplorerChain } from "@/lib/onchain/explorer";
import type { LlamaPrice } from "@/lib/onchain/defillama";

// Google retired the 1.5 family — use 2.5 as fallback when 2.0 is throttled/missing.
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.0-flash";

export type OnchainTargetType = "WALLET" | "TOKEN" | "TRANSACTION";

export type OnchainInsight = {
  type: "flow" | "holders" | "liquidity" | "behavior" | "flag";
  label: string;
  detail: string;
};

export type OnchainAnalysis = {
  summary: string;
  riskLevel: "low" | "medium" | "high";
  insights: OnchainInsight[];
  aiModel: string;
};

export class OnchainAIError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "OnchainAIError";
  }
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new OnchainAIError(
      "Thiếu GEMINI_API_KEY trong .env. Hãy thêm Gemini API key trước khi chạy phân tích on-chain.",
      "MISSING_GEMINI_KEY",
    );
  }
  return key;
}

function buildPrompt(input: {
  chain: ExplorerChain;
  targetType: OnchainTargetType;
  target: string;
  raw: unknown;
  price: LlamaPrice | null;
}): string {
  const { chain, targetType, target, raw, price } = input;
  const rawSnippet = JSON.stringify(raw, null, 2).slice(0, 14000);
  const priceLine = price
    ? `DefiLlama price: $${price.price}${price.symbol ? ` (${price.symbol})` : ""}${
        price.confidence != null ? `, confidence=${price.confidence}` : ""
      }`
    : "DefiLlama price: không có hoặc không tra được.";

  const walletGuidance =
    targetType === "WALLET"
      ? [
          "",
          "Vì target là WALLET, hãy đặc biệt chú ý phần `holdings` trong raw data:",
          "- Liệt kê **3-5 token chính** ví đang nắm giữ (chọn theo balance > 0 và số",
          "  giao dịch nhiều nhất). Mỗi token nêu: symbol, balance ước tính",
          "  (đã chia decimals), số lần mua vs số lần bán trong window gần đây.",
          "- Phân tích **hành vi mua/bán**: incoming.count = số lần nhận token vào ví",
          "  (mua hoặc nhận chuyển), outgoing.count = số lần chuyển ra (bán hoặc gửi).",
          "  Tỉ lệ in/out cho biết ví đang gom (in>>out), xả (out>>in), hay luân chuyển.",
          "- Nếu balance hiện tại > 0 nhưng outgoing.count cao → có thể đang xả dần.",
          "- Nếu balance = 0 và outgoing >> 0 → đã bán hết / chuyển hết.",
          "- Đưa nhận định chỉ dựa trên cửa sổ gần đây (không suy diễn quá xa).",
        ].join("\n")
      : "";

  return [
    "Bạn là chuyên gia phân tích on-chain. Hãy đọc dữ liệu thô từ explorer và",
    "viết báo cáo NGẮN GỌN bằng tiếng Việt, giữ nguyên các thuật ngữ on-chain",
    "tiếng Anh (wallet, token, gas, ERC-20, holder, transfer, swap, DEX...).",
    "",
    `Chain: ${chain}`,
    `Target type: ${targetType}`,
    `Target: ${target}`,
    priceLine,
    walletGuidance,
    "",
    "RAW DATA (đã cắt bớt nếu quá dài):",
    "```json",
    rawSnippet,
    "```",
    "",
    "Yêu cầu output:",
    "- CHỈ trả về JSON hợp lệ, KHÔNG kèm markdown / không kèm ```json fence.",
    "- Schema:",
    "  {",
    '    "summary": "5-6 câu tiếng Việt. Với WALLET, nói rõ: ví đang nắm giữ token chính nào, đang gom hay xả, mức rủi ro.",',
    '    "riskLevel": "low" | "medium" | "high",',
    '    "insights": [',
    '      { "type": "flow"|"holders"|"liquidity"|"behavior"|"flag",',
    '        "label": "tiêu đề ngắn", "detail": "1-2 câu giải thích" }',
    "    ]",
    "  }",
    "- Đưa 4-7 insight. Với WALLET, ít nhất 1 insight `holders` (token đang nắm)",
    "  và 1 insight `behavior` (hành vi mua/bán). Phần còn lại dành cho dòng tiền,",
    "  dấu hiệu rủi ro hoặc cảnh báo (rug, mev, mixer, sandwich...).",
    "- Nếu không đủ dữ liệu, vẫn trả JSON đúng schema và nói rõ trong summary.",
  ].join("\n");
}

function stripFences(text: string): string {
  let t = text.trim();
  // Remove starting ``` or ```json
  t = t.replace(/^```(?:json)?\s*/i, "");
  t = t.replace(/```\s*$/i, "");
  return t.trim();
}

function safeParse(text: string): unknown {
  const stripped = stripFences(text);
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to extract the first {...} block
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeRisk(v: unknown): "low" | "medium" | "high" {
  if (typeof v !== "string") return "medium";
  const s = v.toLowerCase();
  if (s.startsWith("low") || s.includes("thấp")) return "low";
  if (s.startsWith("high") || s.includes("cao")) return "high";
  return "medium";
}

function normalizeInsights(v: unknown): OnchainInsight[] {
  if (!Array.isArray(v)) return [];
  const allowed: OnchainInsight["type"][] = [
    "flow",
    "holders",
    "liquidity",
    "behavior",
    "flag",
  ];
  return v
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const type =
        typeof r.type === "string" && allowed.includes(r.type as OnchainInsight["type"])
          ? (r.type as OnchainInsight["type"])
          : "flag";
      const label = typeof r.label === "string" ? r.label : "";
      const detail = typeof r.detail === "string" ? r.detail : "";
      if (!label && !detail) return null;
      return { type, label, detail } as OnchainInsight;
    })
    .filter((x): x is OnchainInsight => x !== null)
    .slice(0, 8);
}

async function generate(model: GenerativeModel, prompt: string): Promise<string> {
  const res = await model.generateContent(prompt);
  return res.response.text();
}

export async function analyzeOnchain(input: {
  chain: ExplorerChain;
  targetType: OnchainTargetType;
  target: string;
  raw: unknown;
  price?: LlamaPrice | null;
}): Promise<OnchainAnalysis> {
  const client = new GoogleGenerativeAI(apiKey());
  const prompt = buildPrompt({
    chain: input.chain,
    targetType: input.targetType,
    target: input.target,
    raw: input.raw,
    price: input.price ?? null,
  });

  const tryModel = async (name: string): Promise<{ text: string; aiModel: string }> => {
    const model = client.getGenerativeModel({
      model: name,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    });
    const text = await generate(model, prompt);
    return { text, aiModel: name };
  };

  let res: { text: string; aiModel: string };
  try {
    res = await tryModel(PRIMARY_MODEL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fall back when the model is missing or unavailable.
    if (
      /not found|404|UNSUPPORTED|unsupported|not\s+supported/i.test(msg) ||
      /model/i.test(msg)
    ) {
      try {
        res = await tryModel(FALLBACK_MODEL);
      } catch (err2) {
        throw new OnchainAIError(
          `Gemini lỗi: ${err2 instanceof Error ? err2.message : String(err2)}`,
          "GEMINI_ERROR",
        );
      }
    } else {
      throw new OnchainAIError(`Gemini lỗi: ${msg}`, "GEMINI_ERROR");
    }
  }

  const parsed = safeParse(res.text);
  if (!parsed || typeof parsed !== "object") {
    throw new OnchainAIError(
      "Gemini trả về dữ liệu không phải JSON hợp lệ.",
      "BAD_AI_OUTPUT",
    );
  }

  const obj = parsed as Record<string, unknown>;
  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    riskLevel: normalizeRisk(obj.riskLevel),
    insights: normalizeInsights(obj.insights),
    aiModel: res.aiModel,
  };
}
