/**
 * GET OKX futures floating-PnL + open positions (same shape as the other
 * broker account endpoints so the settings card and dashboard reuse types).
 *
 * OKX is a unified account — the money shows under Spot; this returns the
 * open positions (and their floating PnL) for the card.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { loadCreds } from "@/lib/brokers/store";
import {
  getAccountBalance,
  getOpenPositions,
  OkxError,
  type OkxCreds,
} from "@/lib/brokers/okx";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const creds = await loadCreds<OkxCreds>(session.user.id, "OKX");
  if (!creds) {
    return NextResponse.json({ error: "Chưa kết nối OKX" }, { status: 404 });
  }

  try {
    const [balance, positions] = await Promise.all([
      getAccountBalance(creds),
      getOpenPositions(creds),
    ]);
    return NextResponse.json({ balance, positions });
  } catch (e) {
    if (e instanceof OkxError) {
      return NextResponse.json({ error: e.toVietnamese() }, { status: 502 });
    }
    const msg = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
