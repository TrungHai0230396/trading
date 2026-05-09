import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { runInsights } from "@/lib/insights/runner";
import { GeminiError } from "@/lib/ai/gemini";

const bodySchema = z.object({
  market: z.enum(["FOREX", "CRYPTO"]),
  symbols: z.array(z.string().min(2).max(20)).min(1).max(20),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Thiếu GEMINI_API_KEY. Vui lòng cấu hình trước khi chạy phân tích.",
      },
      { status: 503 },
    );
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
    const result = await runInsights({
      userId: session.user.id,
      market: parsed.data.market,
      symbols: parsed.data.symbols,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GeminiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const msg =
      err instanceof Error ? err.message : "Phân tích thất bại không xác định";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
