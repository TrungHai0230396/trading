/**
 * POST /api/journal/sync-broker
 *
 * Read-only import of the user's OPEN positions from every connected exchange
 * (Bitget / Binance / MEXC) into the journal. Never writes to any exchange.
 * See lib/brokers/import-positions.ts for the contract.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { importOpenPositions } from "@/lib/brokers/import-positions";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  // Enough for "auto on mount + manual button + occasional poll", bars loops.
  if (!rateLimit(`journal-sync:${session.user.id}`, 6, 60_000)) {
    return NextResponse.json(
      { error: "Đồng bộ quá nhiều lần trong 1 phút. Đợi rồi thử lại." },
      { status: 429 },
    );
  }

  try {
    const result = await importOpenPositions(session.user.id);
    return NextResponse.json(result);
  } catch (e) {
    // Per-broker fetch/write errors degrade inside importOpenPositions; a
    // throw here is DB/decrypt trouble whose raw message can leak internals.
    console.error("[sync-broker]", e);
    return NextResponse.json({ error: "Không đồng bộ được. Thử lại sau." }, { status: 500 });
  }
}
