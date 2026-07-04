/**
 * Bitget credentials endpoint (Phase 1 read-only).
 *
 * POST   — validate creds, test connection, save (test BEFORE save so
 *          we never store bad creds).
 * DELETE — remove saved creds + metadata.
 *
 * NEVER log request body. NEVER return secret/passphrase in responses.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { maskSecret } from "@/lib/crypto";
import {
  saveCreds,
  deleteCreds,
  setBrokerMeta,
  getBrokerMeta,
  hasCreds,
} from "@/lib/brokers/store";
import { rateLimit } from "@/lib/brokers/rate-limit";
import {
  testConnection,
  getAccountBalance,
  type BitgetCreds,
} from "@/lib/brokers/bitget";

export const runtime = "nodejs";

const Body = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20)
    .max(120)
    .regex(/^bg_[A-Za-z0-9]+$/, "Bitget API key bắt đầu bằng bg_"),
  secret: z.string().trim().min(20).max(200),
  passphrase: z.string().trim().min(1).max(64),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;
  const connected = await hasCreds(userId, "BITGET");
  const meta = await getBrokerMeta(userId, "BITGET");
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }
  const creds: BitgetCreds = parsed.data;

  // Test BEFORE persisting.
  const test = await testConnection(creds);
  if (!test.ok) {
    return NextResponse.json({ error: test.error, code: test.code }, {
      status: 400,
    });
  }

  // Fetch balance so the UI can echo "Đã lưu — equity 1234 USDT" right away.
  const balance = await getAccountBalance(creds).catch(() => null);

  await saveCreds(userId, "BITGET", creds);
  await setBrokerMeta(userId, "BITGET", {
    uid: test.uid,
    apiKeyLast4: creds.apiKey.slice(-4),
    apiKeyMasked: maskSecret(creds.apiKey),
    savedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    uid: test.uid,
    apiKeyMasked: maskSecret(creds.apiKey),
    balance,
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  await deleteCreds(session.user.id, "BITGET");
  return NextResponse.json({ ok: true });
}
