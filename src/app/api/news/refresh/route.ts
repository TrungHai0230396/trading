import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { refreshNewsForUser } from "@/lib/news/service";
import { CryptoPanicError } from "@/lib/news/cryptopanic";
import { GeminiError } from "@/lib/ai/gemini";

const FILTERS = [
  "rising",
  "hot",
  "bullish",
  "bearish",
  "important",
  "saved",
  "lol",
] as const;

const bodySchema = z
  .object({
    filter: z.enum(FILTERS).optional(),
  })
  .optional();

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  let body: unknown = undefined;
  if (req.headers.get("content-length") !== "0") {
    try {
      body = await req.json();
    } catch {
      // ignore — body is optional
    }
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const summary = await refreshNewsForUser(session.user.id, {
      filter: parsed.data?.filter,
    });
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof CryptoPanicError || err instanceof GeminiError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
