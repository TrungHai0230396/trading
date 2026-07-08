/**
 * Public registration endpoint.
 *
 * Hardening for open registration:
 *   - per-IP rate limit (5/hour) — blunts scripted signup spam
 *   - normalized (lowercased) email — one account per mailbox, and the
 *     entitlement allowlist compares lowercase
 *   - password policy: >=8 chars with at least one letter and one digit
 *   - explicit Terms/Disclaimer consent required; acceptance timestamp is
 *     stored (AppSetting `legal:tos-accepted`) as evidence
 *   - constant-ish work on duplicate email (hash anyway) to soften timing
 *     probes; the 409 message itself is a deliberate UX tradeoff
 *   - kill-switch: ALLOW_REGISTRATION=false closes the door instantly
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/brokers/rate-limit";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email().max(200),
  password: z
    .string()
    .min(8, "Mật khẩu tối thiểu 8 ký tự")
    .max(200)
    .regex(/[a-zA-Z]/, "Mật khẩu cần ít nhất 1 chữ cái")
    .regex(/[0-9]/, "Mật khẩu cần ít nhất 1 chữ số"),
  acceptTerms: z.literal(true, {
    message: "Bạn cần đồng ý Điều khoản sử dụng & Miễn trừ trách nhiệm.",
  }),
});

function registrationAllowed(): boolean {
  return process.env.ALLOW_REGISTRATION !== "false";
}

function clientIp(req: Request): string {
  // Single-container deploys may sit behind a reverse proxy later —
  // x-forwarded-for first, then fall back to a shared bucket.
  const xf = req.headers.get("x-forwarded-for");
  return xf?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request) {
  if (!registrationAllowed()) {
    return NextResponse.json(
      { error: "Tính năng đăng ký đang tạm đóng." },
      { status: 403 },
    );
  }

  const ip = clientIp(req);
  if (!rateLimit(`register:${ip}`, 5, 60 * 60_000)) {
    return NextResponse.json(
      { error: "Quá nhiều lần đăng ký từ địa chỉ này. Thử lại sau 1 giờ." },
      { status: 429 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const name = parsed.data.name;
  const email = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;

  // Hash BEFORE the duplicate check so both paths cost roughly the same
  // wall-clock — a cheap anti-enumeration-by-timing measure.
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Email này đã được đăng ký." },
      { status: 409 },
    );
  }

  const user = await db.user.create({
    data: { name, email, passwordHash },
    select: { id: true, email: true, name: true },
  });

  // Evidence of consent — commercial requirement for a trading tool.
  await db.appSetting.create({
    data: {
      userId: user.id,
      key: "legal:tos-accepted",
      value: { at: new Date().toISOString(), version: "2026-07-07" },
    },
  });

  return NextResponse.json({ user }, { status: 201 });
}
