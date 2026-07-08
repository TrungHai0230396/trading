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
  // x-forwarded-for is client-controlled unless a trusted reverse proxy
  // overwrites it. Only trust it when TRUST_PROXY=true (set that ONLY once
  // a proxy that strips inbound XFF is in front). Otherwise a scripted
  // attacker rotates the header to dodge the per-IP limit entirely, so we
  // fall back to a single shared bucket — the limit then applies globally,
  // which is strict but not bypassable.
  if (process.env.TRUST_PROXY === "true") {
    const xf = req.headers.get("x-forwarded-for");
    if (xf) return xf.split(",")[0]?.trim() || "unknown";
  }
  return "shared";
}

export async function POST(req: Request) {
  if (!registrationAllowed()) {
    return NextResponse.json(
      { error: "Tính năng đăng ký đang tạm đóng." },
      { status: 403 },
    );
  }

  const ip = clientIp(req);
  // Per-real-IP: strict (5/hr). Shared fallback (no trusted proxy): a
  // higher global backstop that throttles a signup flood without blocking
  // a normal launch day. Real per-IP limiting kicks in once TRUST_PROXY=true.
  const [maxReg, regWindow] =
    ip === "shared" ? [60, 60 * 60_000] : [5, 60 * 60_000];
  if (!rateLimit(`register:${ip}`, maxReg, regWindow)) {
    return NextResponse.json(
      { error: "Quá nhiều lượt đăng ký lúc này. Thử lại sau ít phút." },
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

  // The check above is a fast path; the unique index is the real guard.
  // Two concurrent same-email requests both pass findUnique, so the loser
  // hits P2002 — turn that into a clean 409 instead of a 500.
  let user: { id: string; email: string; name: string | null };
  try {
    user = await db.user.create({
      data: { name, email, passwordHash },
      select: { id: true, email: true, name: true },
    });
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Email này đã được đăng ký." },
        { status: 409 },
      );
    }
    throw e;
  }

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
