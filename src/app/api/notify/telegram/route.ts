/**
 * Telegram linking endpoint (ONE system bot).
 *
 * GET    → { enabled, connected, prefs }
 * POST   → mint a link code, return { url } = t.me/<bot>?start=<code>
 * PATCH  → set the personal-DM opt-ins (weekly digest, SL/TP level watch)
 * DELETE → unlink (clear the user's telegramChatId)
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { telegramEnabled, getBotUsername } from "@/lib/notify/telegram";
import { createLinkCode } from "@/lib/notify/telegram-link";
import {
  getPersonalDmPrefs,
  setPersonalDmPrefs,
} from "@/lib/notify/consensus-config";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const [user, prefs] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { telegramChatId: true },
    }),
    getPersonalDmPrefs(session.user.id),
  ]);
  return NextResponse.json({
    enabled: telegramEnabled(),
    connected: Boolean(user?.telegramChatId),
    prefs,
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

/**
 * Opt-ins for the two DMs about the user's own journal. Both are plain
 * booleans and both default OFF — see PersonalDmPrefs.
 */
const PrefsBody = z.object({
  weeklyDigest: z.boolean(),
  levelWatch: z.boolean(),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  if (!rateLimit(`tg-prefs:${session.user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: "Thử lại sau ít giây." }, { status: 429 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = PrefsBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }
  await setPersonalDmPrefs(session.user.id, parsed.data);
  return NextResponse.json({ ok: true, prefs: parsed.data });
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
