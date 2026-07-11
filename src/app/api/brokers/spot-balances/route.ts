/**
 * GET /api/brokers/spot-balances — read-only spot portfolio across the
 * user's connected brokers (Bitget + Binance). Backed by a 60s per-user
 * cache in lib/brokers/spot.ts; the rate limit here is just a loop guard.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getSpotPortfolio } from "@/lib/brokers/spot";
import { rateLimit } from "@/lib/brokers/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (!rateLimit(`spot:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu. Thử lại sau ít giây." },
      { status: 429 },
    );
  }

  try {
    const portfolio = await getSpotPortfolio(session.user.id);
    return NextResponse.json(portfolio);
  } catch (err) {
    // Exchange failures are handled per-broker inside getSpotPortfolio; a
    // throw here means DB/decrypt trouble whose raw message can leak
    // internals (DB host, env var names) — log it, return a generic error.
    console.error("[spot-balances]", err);
    return NextResponse.json(
      { error: "Không tải được số dư spot. Thử lại sau." },
      { status: 502 },
    );
  }
}
