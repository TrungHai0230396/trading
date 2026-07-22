/**
 * MEXC credentials endpoint. Same contract as the Binance/Bitget ones:
 * GET status, POST validate+test+save (AES-256-GCM), DELETE disconnect.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { maskSecret } from "@/lib/crypto";
import {
  saveCreds,
  deleteCreds,
  hasCreds,
  setBrokerMeta,
  getBrokerMeta,
} from "@/lib/brokers/store";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { invalidatePortfolio } from "@/lib/brokers/spot";
import { testConnection, type MexcCreds } from "@/lib/brokers/mexc";

export const runtime = "nodejs";

const Body = z.object({
  apiKey: z.string().trim().min(16).max(200),
  secret: z.string().trim().min(16).max(200),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;
  const connected = await hasCreds(userId, "MEXC");
  const meta = await getBrokerMeta(userId, "MEXC");
  return NextResponse.json({ connected, meta });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`broker-save:${userId}`, 5, 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều lần lưu trong 1 phút. Đợi rồi thử lại." },
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
  const creds: MexcCreds = parsed.data;

  const test = await testConnection(creds);
  if (!test.ok) {
    return NextResponse.json({ error: test.error }, { status: 400 });
  }

  await saveCreds(userId, "MEXC", creds);
  // New key → the cached (possibly empty) portfolio is stale immediately.
  invalidatePortfolio(userId);
  await setBrokerMeta(userId, "MEXC", {
    apiKeyMasked: maskSecret(creds.apiKey, 4),
    savedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    apiKeyMasked: maskSecret(creds.apiKey, 4),
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  await deleteCreds(session.user.id, "MEXC");
  invalidatePortfolio(session.user.id);
  return NextResponse.json({ ok: true });
}
