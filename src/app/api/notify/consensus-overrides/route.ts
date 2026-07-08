/**
 * Per-coin timeframe overrides for the consensus alert.
 *
 * GET  → { overrides: { SYMBOL: string[] } }
 * POST → { symbol, timeframes: string[] | null }  (null / <2 clears)
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { isTimeframe, type Timeframe } from "@/lib/scanner/candles";
import { getTfOverrides, setTfOverride } from "@/lib/notify/consensus-config";

export const runtime = "nodejs";

const Body = z.object({
  symbol: z.string().trim().min(2).max(20),
  timeframes: z
    .array(z.string())
    .max(7)
    .nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const overrides = await getTfOverrides(session.user.id);
  return NextResponse.json({ overrides });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const { symbol } = parsed.data;
  const tfs: Timeframe[] | null =
    parsed.data.timeframes === null
      ? null
      : parsed.data.timeframes.filter((t): t is Timeframe => isTimeframe(t));

  // Empty list = clear (fall back to the global default). 1 khung is a
  // legitimate single-TF signal alert — allowed.
  if (tfs !== null && tfs.length === 0) {
    return NextResponse.json(
      { error: "Chọn ít nhất 1 khung, hoặc dùng nút Về mặc định." },
      { status: 400 },
    );
  }

  await setTfOverride(session.user.id, symbol, tfs);
  return NextResponse.json({ ok: true });
}
