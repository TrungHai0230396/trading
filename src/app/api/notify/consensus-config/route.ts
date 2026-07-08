/**
 * GET/POST the consensus-alert configuration (timeframes, direction,
 * on/off). Consumed by the 15-minute cron scan.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { isTimeframe } from "@/lib/scanner/candles";
import {
  getConsensusConfig,
  setConsensusConfig,
  DEFAULT_CONSENSUS_CONFIG,
} from "@/lib/notify/consensus-config";

export const runtime = "nodejs";

const Body = z.object({
  enabled: z.boolean(),
  timeframes: z
    .array(z.string().refine(isTimeframe, { message: "Timeframe không hợp lệ" }))
    .min(1, "Chọn ít nhất 1 khung.")
    .max(7),
  notifyBullish: z.boolean(),
  notifyBearish: z.boolean(),
  notifyBreak: z.boolean().default(true),
}).refine((b) => b.notifyBullish || b.notifyBearish, {
  message: "Phải bật ít nhất một hướng (Bullish hoặc Bearish).",
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const config = await getConsensusConfig(session.user.id);
  return NextResponse.json({ config, defaults: DEFAULT_CONSENSUS_CONFIG });
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
  await setConsensusConfig(session.user.id, parsed.data);
  return NextResponse.json({ ok: true, config: parsed.data });
}
