import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getCandles, type Timeframe } from "@/lib/scanner/candles";
import { ALL_TIMEFRAMES } from "@/lib/scanner/candles";
import { rateLimit } from "@/lib/brokers/rate-limit";

const requestSchema = z.object({
  // Crypto-only scanner — forex removed (see scanner/runs route).
  market: z.enum(["CRYPTO"]),
  symbol: z.string().min(2).max(20),
  timeframe: z.enum(ALL_TIMEFRAMES as [string, ...string[]]),
  limit: z.coerce.number().int().min(50).max(1000).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  // Each call pulls up to 1000 bars from Binance (public) or the shared
  // TwelveData key. Cap per user so a loop can't hammer either. The global
  // TwelveData budget in candles.ts is the ultimate backstop for forex.
  if (!rateLimit(`candles:${session.user.id}`, 30, 60_000)) {
    return NextResponse.json(
      { error: "Bạn tải biểu đồ quá nhanh. Thử lại sau ít giây." },
      { status: 429 },
    );
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
