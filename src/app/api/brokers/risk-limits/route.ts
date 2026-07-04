/**
 * GET/POST the user's order-placement risk limits.
 * Enforced server-side in /api/brokers/bitget/order.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  getRiskLimits,
  setRiskLimits,
  DEFAULT_RISK_LIMITS,
} from "@/lib/brokers/risk-limits";

export const runtime = "nodejs";

const Body = z.object({
  maxRiskPct: z.number().positive().max(100),
  maxOpenPositions: z.number().int().min(1).max(50),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const limits = await getRiskLimits(session.user.id);
  return NextResponse.json({ limits, defaults: DEFAULT_RISK_LIMITS });
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
  await setRiskLimits(session.user.id, parsed.data);
  return NextResponse.json({ ok: true, limits: parsed.data });
}
