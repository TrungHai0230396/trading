/**
 * POST /api/account/change-password
 *
 * Requires the CURRENT password (a stolen session alone can't rotate the
 * password and lock the owner out) + the same strength policy as
 * registration. Rate-limited: 5 attempts / 15 minutes per user.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { auth, googleOnlyIntent } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/brokers/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  // Empty allowed: Google-only accounts have no current password — they
  // SET one here (still requires an authenticated session).
  currentPassword: z.string(),
  newPassword: z
    .string()
    .min(8, "Mật khẩu mới tối thiểu 8 ký tự")
    .max(200)
    .regex(/[a-zA-Z]/, "Mật khẩu mới cần ít nhất 1 chữ cái")
    .regex(/[0-9]/, "Mật khẩu mới cần ít nhất 1 chữ số"),
});

export async function POST(req: Request) {
  // Google-only mode: passwords must not exist at all. Without this, a
  // session could SET a password here and keep credentials login as a
  // persistent side door around the Google-only policy.
  if (googleOnlyIntent) {
    return NextResponse.json(
      { error: "Chỉ hỗ trợ đăng nhập bằng Google." },
      { status: 403 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`chpass:${userId}`, 5, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều lần thử. Đợi 15 phút rồi thử lại." },
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

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Không tìm thấy tài khoản" }, { status: 404 });
  }

  // Google-only accounts (no local password yet) may SET one directly —
  // the authenticated session is the proof of ownership. Accounts WITH a
  // password must present it.
  if (user.passwordHash) {
    const ok = await bcrypt.compare(
      parsed.data.currentPassword,
      user.passwordHash,
    );
    if (!ok) {
      return NextResponse.json(
        { error: "Mật khẩu hiện tại không đúng." },
        { status: 400 },
      );
    }
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await db.user.update({ where: { id: userId }, data: { passwordHash } });

  return NextResponse.json({ ok: true });
}
