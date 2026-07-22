/**
 * GET MEXC futures balance + open positions (same shape as the Binance/
 * Bitget account endpoints, so the settings card and dashboard reuse types).
 *
 * MEXC futures API needs a KYC'd key with Futures permission; a spot-only
 * key returns a permission error here, which the card surfaces as-is.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { loadCreds } from "@/lib/brokers/store";
import {
  getAccountBalance,
  getOpenPositions,
  MexcError,
  type MexcCreds,
} from "@/lib/brokers/mexc";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const creds = await loadCreds<MexcCreds>(session.user.id, "MEXC");
  if (!creds) {
    return NextResponse.json({ error: "Chưa kết nối MEXC" }, { status: 404 });
  }

  try {
    const [balance, positions] = await Promise.all([
      getAccountBalance(creds),
      getOpenPositions(creds),
    ]);
    return NextResponse.json({ balance, positions });
  } catch (e) {
    if (e instanceof MexcError) {
      return NextResponse.json({ error: e.toVietnamese() }, { status: 502 });
    }
    const msg = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
