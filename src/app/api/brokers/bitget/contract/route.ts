/**
 * GET /api/brokers/bitget/contract?symbol=BTCUSDT
 *
 * Returns the Bitget USDT-FUTURES contract spec for a symbol so the
 * trade-form confirm dialog can preview normalized size/price, min
 * notional and the maintainMarginRate used in the liq-price estimate.
 *
 * Public (per-user auth required) and cached for 5 min server-side —
 * contract specs change rarely.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { fetchContractSpec } from "@/lib/brokers/bitget";

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
        {
          error:
            "Không tìm thấy hợp đồng trên Bitget USDT-Futures (có thể đã ngừng giao dịch).",
        },
        { status: 404 },
      );
    }
    if (spec.symbolStatus !== "normal") {
      return NextResponse.json(
        {
          error: `Cặp đang ở trạng thái ${spec.symbolStatus} trên Bitget — không vào lệnh được lúc này.`,
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
