/**
 * POST /api/feedback — a tester reports a bug / requests a feature / says hi.
 * Saved to the Feedback table and (best-effort) pinged to the owner's
 * Telegram. Auth-gated + rate-limited (public users → abuse surface).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { notifyOwner } from "@/lib/notify/owner";

export const runtime = "nodejs";

const Body = z.object({
  type: z.enum(["BUG", "FEATURE", "OTHER"]),
  message: z
    .string()
    .trim()
    .min(5, "Nội dung tối thiểu 5 ký tự")
    .max(4000, "Nội dung tối đa 4000 ký tự"),
  // 191 matches the DB column (VARCHAR(191)); anything longer would 500 on
  // insert. It's a short "which page" note, not a body.
  context: z.string().trim().max(191, "Ghi chú trang quá dài").optional(),
});

const TYPE_LABEL: Record<z.infer<typeof Body>["type"], string> = {
  BUG: "🐞 Báo lỗi",
  FEATURE: "✨ Tính năng mới",
  OTHER: "💬 Góp ý",
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  // 5 submissions / 10 min — generous for a real tester, stops a flood.
  if (!rateLimit(`feedback:${userId}`, 5, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Bạn gửi hơi nhiều. Thử lại sau ít phút nhé." },
      { status: 429 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const email = session.user.email ?? null;
  const { type, message, context } = parsed.data;

  try {
    await db.feedback.create({
      data: { userId, email, type, message, context: context ?? null },
    });
  } catch (err) {
    console.error("[feedback]", err);
    return NextResponse.json(
      { error: "Không lưu được phản hồi. Thử lại sau." },
      { status: 500 },
    );
  }

  // Fire-and-forget owner ping — never blocks or fails the user's submit.
  void notifyOwner(
    `${TYPE_LABEL[type]} — phản hồi mới trên Nhật Ký Trade\n` +
      `Từ: ${email ?? "?"}\n` +
      (context ? `Trang: ${context}\n` : "") +
      `\n${message.slice(0, 1500)}`,
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
