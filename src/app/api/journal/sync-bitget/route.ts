/**
 * POST /api/journal/sync-bitget
 *
 * Read-only sync from Bitget back to the user's journal entries. Never
 * writes to Bitget. See lib/brokers/sync.ts for the full contract.
 *
 * Rate-limited per user so a runaway client polling loop can't burn
 * through Bitget API quota. Returns the same SyncResult shape as the
 * orchestrator so the UI can toast each change.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { syncUserBrokerOrders } from "@/lib/brokers/sync";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  // 6 calls/minute is enough for "auto on mount + manual button + occasional
  // refetch" but bars accidental loops.
  if (!rateLimit(`journal-sync:${session.user.id}`, 6, 60_000)) {
    return NextResponse.json(
      { error: "Đồng bộ quá nhiều lần trong 1 phút. Đợi rồi thử lại." },
      { status: 429 },
    );
  }

  try {
    const result = await syncUserBrokerOrders(session.user.id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi đồng bộ" },
      { status: 500 },
    );
  }
}
