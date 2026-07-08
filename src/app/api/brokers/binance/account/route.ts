/**
 * GET Binance balance + open positions (same shape as the Bitget
 * account endpoint, so the settings card and dashboard can reuse types).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { loadCreds } from "@/lib/brokers/store";
import {
  getAccountBalance,
  getOpenPositions,
  BinanceError,
  type BinanceCreds,
} from "@/lib/brokers/binance";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const creds = await loadCreds<BinanceCreds>(session.user.id, "BINANCE");
  if (!creds) {
    return NextResponse.json(
      { error: "Chưa kết nối Binance" },
      { status: 404 },
    );
  }

  try {
    const [balance, positions] = await Promise.all([
      getAccountBalance(creds),
      getOpenPositions(creds),
    ]);
    return NextResponse.json({ balance, positions });
  } catch (e) {
    if (e instanceof BinanceError) {
      return NextResponse.json({ error: e.toVietnamese() }, { status: 502 });
    }
    const msg = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
