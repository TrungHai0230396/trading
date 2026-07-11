/**
 * Position mode endpoint.
 *
 * GET   → returns current { posMode }
 * POST  → sets posMode (body: { mode: "one_way_mode" | "hedge_mode" })
 *
 * Bitget rejects a switch if there is any open position or pending order
 * on the productType — error surfaces in Vietnamese.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { loadCreds } from "@/lib/brokers/store";
import { rateLimit } from "@/lib/brokers/rate-limit";
import {
  canAutoTrade,
  AUTOTRADE_FORBIDDEN_MESSAGE,
} from "@/lib/brokers/entitlements";
import {
  getPositionMode,
  setPositionMode,
  BitgetError,
  type BitgetCreds,
} from "@/lib/brokers/bitget";

export const runtime = "nodejs";

const Body = z.object({
  mode: z.enum(["one_way_mode", "hedge_mode"]),
});

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
    const mode = await getPositionMode(creds);
    return NextResponse.json({ mode });
  } catch (e) {
    if (e instanceof BitgetError) {
      return NextResponse.json(
        { error: e.toVietnamese(), code: e.code },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi không xác định" },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  // Live exchange write — same entitlement gate as every other write route
  // (this one was the lone gap: a read-only public user could flip their
  // account's hedge/one-way mode).
  if (!(await canAutoTrade(userId))) {
    return NextResponse.json(
      { error: AUTOTRADE_FORBIDDEN_MESSAGE },
      { status: 403 },
    );
  }

  if (!rateLimit(`broker-posmode:${userId}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều lần đổi trong 1 phút. Đợi rồi thử lại." },
      { status: 429 },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const creds = await loadCreds<BitgetCreds>(userId, "BITGET");
  if (!creds) {
    return NextResponse.json(
      { error: "Chưa kết nối Bitget" },
      { status: 404 },
    );
  }

  try {
    await setPositionMode(creds, parsed.data.mode);
    return NextResponse.json({ ok: true, mode: parsed.data.mode });
  } catch (e) {
    if (e instanceof BitgetError) {
      return NextResponse.json(
        { error: e.toVietnamese(), code: e.code },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi không xác định" },
      { status: 502 },
    );
  }
}
