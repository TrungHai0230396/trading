/**
 * Telegram notification credentials endpoint.
 *
 * GET    → { connected, meta }
 * POST   → validate via getMe + test message, then save encrypted
 * DELETE → disconnect
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
import { testTelegram, type TelegramCreds } from "@/lib/notify/telegram";

export const runtime = "nodejs";

const Body = z.object({
  botToken: z.string().trim().min(20).max(200),
  chatId: z.string().trim().min(1).max(50),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;
  const connected = await hasCreds(userId, "TELEGRAM");
  const meta = await getBrokerMeta(userId, "TELEGRAM");
  return NextResponse.json({ connected, meta });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`telegram-save:${userId}`, 5, 60_000)) {
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
  const creds: TelegramCreds = parsed.data;

  const test = await testTelegram(creds);
  if (!test.ok) {
    return NextResponse.json({ error: test.error }, { status: 400 });
  }

  await saveCreds(userId, "TELEGRAM", creds);
  await setBrokerMeta(userId, "TELEGRAM", {
    botName: test.botName,
    chatId: creds.chatId,
    tokenMasked: maskSecret(creds.botToken, 4),
    savedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, botName: test.botName });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  await deleteCreds(session.user.id, "TELEGRAM");
  return NextResponse.json({ ok: true });
}
