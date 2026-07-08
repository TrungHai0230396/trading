/**
 * GET /api/brokers/binance/contract?symbol=BTCUSDT
 *
 * Binance USDT-M contract spec, same response shape as the Bitget
 * contract endpoint so the auto-place dialog is broker-agnostic.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { fetchContractSpec } from "@/lib/brokers/binance";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(symbol)) {
    return NextResponse.json(
      { error: "Symbol không hợp lệ. Ví dụ: BTCUSDT." },
      { status: 400 },
    );
  }

  try {
    const spec = await fetchContractSpec(symbol);
    if (!spec) {
      return NextResponse.json(
        { error: "Không tìm thấy hợp đồng trên Binance USDT-M Futures." },
        { status: 404 },
      );
    }
    if (spec.symbolStatus !== "normal") {
      return NextResponse.json(
        {
          error: `Cặp đang ở trạng thái ${spec.symbolStatus} trên Binance — không vào lệnh được lúc này.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ spec });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Không tra được hợp đồng";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
