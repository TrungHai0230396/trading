/**
 * GET balance + open positions from the saved Bitget creds. Used by the
 * dashboard widget on the analysis page (and any future broker view).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { loadCreds } from "@/lib/brokers/store";
import {
  getAccountBalance,
  getOpenPositions,
  type BitgetCreds,
  BitgetError,
} from "@/lib/brokers/bitget";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const creds = await loadCreds<BitgetCreds>(session.user.id, "BITGET");
  if (!creds) {
    return NextResponse.json(
      { error: "Chưa kết nối Bitget" },
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
    if (e instanceof BitgetError) {
      return NextResponse.json({ error: e.toVietnamese() }, { status: 502 });
    }
    const msg = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
