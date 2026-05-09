import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { runOnchainReport } from "@/lib/onchain/service";
import {
  ExplorerError,
  MissingKeyError,
  RateLimitError,
} from "@/lib/onchain/explorer";
import { OnchainAIError } from "@/lib/ai/onchain";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TXHASH_RE = /^0x[a-fA-F0-9]{64}$/;

const bodySchema = z
  .object({
    chain: z.enum(["ETH", "BSC"]),
    targetType: z.enum(["WALLET", "TOKEN", "TRANSACTION"]),
    target: z.string().min(1).max(128),
  })
  .superRefine((val, ctx) => {
    const trimmed = val.target.trim();
    if (val.targetType === "TRANSACTION") {
      if (!TXHASH_RE.test(trimmed)) {
        ctx.addIssue({
          code: "custom",
          message: "Tx hash phải có dạng 0x + 64 ký tự hex.",
          path: ["target"],
        });
      }
    } else {
      if (!ADDRESS_RE.test(trimmed)) {
        ctx.addIssue({
          code: "custom",
          message: "Address phải có dạng 0x + 40 ký tự hex.",
          path: ["target"],
        });
      }
    }
  });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const report = await runOnchainReport({
      userId: session.user.id,
      chain: parsed.data.chain,
      targetType: parsed.data.targetType,
      target: parsed.data.target.trim(),
    });
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof MissingKeyError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Explorer đang bị rate-limit. Thử lại sau ít phút." },
        { status: 429 },
      );
    }
    if (err instanceof OnchainAIError) {
      const status = err.code === "MISSING_GEMINI_KEY" ? 400 : 502;
      return NextResponse.json({ error: err.message }, { status });
    }
    if (err instanceof ExplorerError) {
      return NextResponse.json(
        { error: `Explorer lỗi: ${err.message}` },
        { status: 502 },
      );
    }
    const msg = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
