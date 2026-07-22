/**
 * Telegram linking endpoint (ONE system bot).
 *
 * GET    → { enabled, connected }
 * POST   → mint a link code, return { url } = t.me/<bot>?start=<code>
 * DELETE → unlink (clear the user's telegramChatId)
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { telegramEnabled, getBotUsername } from "@/lib/notify/telegram";
import { createLinkCode } from "@/lib/notify/telegram-link";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { telegramChatId: true },
  });
  return NextResponse.json({
    enabled: telegramEnabled(),
    connected: Boolean(user?.telegramChatId),
  });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  if (!telegramEnabled()) {
    return NextResponse.json(
      { error: "Kênh Telegram chưa được cấu hình trên hệ thống." },
      { status: 503 },
    );
  }
  if (!rateLimit(`tg-link:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "Thử lại sau ít giây." }, { status: 429 });
  }

  const username = await getBotUsername();
  if (!username) {
    return NextResponse.json(
      { error: "Không lấy được thông tin bot. Thử lại sau." },
      { status: 502 },
    );
  }

  const code = await createLinkCode(session.user.id);
  return NextResponse.json({ url: `https://t.me/${username}?start=${code}` });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  await db.user.update({
    where: { id: session.user.id },
    data: { telegramChatId: null, telegramLinkedAt: null },
  });
  return NextResponse.json({ ok: true });
}
