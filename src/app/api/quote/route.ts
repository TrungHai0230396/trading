import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getPrice } from "@/lib/quotes";

const querySchema = z.object({
  market: z.enum(["FOREX", "CRYPTO"]),
  symbol: z.string().min(2).max(20),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    market: (url.searchParams.get("market") ?? "").toUpperCase(),
    symbol: url.searchParams.get("symbol") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Query không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const quote = await getPrice(parsed.data.market, parsed.data.symbol);
    return NextResponse.json(quote);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
