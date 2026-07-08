/**
 * GET /api/brokers/entitlements — read-only view of the caller's feature
 * grants. The UI uses this to hide real-money controls for read-only
 * accounts. Server-side enforcement lives in each write route; this
 * endpoint is presentation only.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { canAutoTrade } from "@/lib/brokers/entitlements";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const autoTrade = await canAutoTrade(session.user.id);
  return NextResponse.json({ autoTrade });
}
