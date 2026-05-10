import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getCandles, type Timeframe } from "@/lib/scanner/candles";
import { ALL_TIMEFRAMES } from "@/lib/scanner/candles";

const requestSchema = z.object({
  market: z.enum(["FOREX", "CRYPTO"]),
  symbol: z.string().min(2).max(20),
  timeframe: z.enum(ALL_TIMEFRAMES as [string, ...string[]]),
  limit: z.coerce.number().int().min(50).max(1000).optional(),
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

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const closes = await getCandles({
      market: parsed.data.market,
      symbol: parsed.data.symbol,
      timeframe: parsed.data.timeframe as Timeframe,
      limit: parsed.data.limit,
    });
    return NextResponse.json({ closes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
