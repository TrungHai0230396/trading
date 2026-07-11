/**
 * GET /api/brokers/portfolio — read-only unified portfolio: spot + futures
 * across every connected broker, one grand total. Backed by a 60s per-user
 * cache in lib/brokers/spot.ts; the rate limit here is just a loop guard.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getPortfolio } from "@/lib/brokers/spot";
import { rateLimit } from "@/lib/brokers/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (!rateLimit(`portfolio:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu. Thử lại sau ít giây." },
      { status: 429 },
    );
  }

  try {
    const portfolio = await getPortfolio(session.user.id);
    return NextResponse.json(portfolio);
  } catch (err) {
    // Exchange failures degrade per-section inside getPortfolio; a throw
    // here means DB/decrypt trouble whose raw message can leak internals
    // (DB host, env var names) — log it, return a generic error.
    console.error("[portfolio]", err);
    return NextResponse.json(
      { error: "Không tải được tài sản. Thử lại sau." },
      { status: 502 },
    );
  }
}
