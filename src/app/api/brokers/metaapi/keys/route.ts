/**
 * MetaApi credentials endpoint.
 *
 * POST flow:
 *   1. Validate token first (cheap).
 *   2. Provision the MT account via MetaApi (sends MT login/password
 *      to their cloud — we NEVER store those locally).
 *   3. Persist only { token, accountId }.
 *
 * DELETE: removes the cloud account too so MetaApi stops billing.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { maskSecret } from "@/lib/crypto";
import {
  saveCreds,
  loadCreds,
  deleteCreds,
  setBrokerMeta,
  getBrokerMeta,
  hasCreds,
} from "@/lib/brokers/store";
import { rateLimit } from "@/lib/brokers/rate-limit";
import {
  testToken,
  addAccount,
  removeAccount,
  type MetaApiCreds,
} from "@/lib/brokers/metaapi";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().trim().min(20).max(4000),
  login: z.string().trim().min(3).max(40),
  password: z.string().trim().min(1).max(200),
  server: z.string().trim().min(3).max(80),
  platform: z.enum(["mt4", "mt5"]),
  name: z.string().trim().max(80).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;
  const connected = await hasCreds(userId, "METAAPI");
  const meta = await getBrokerMeta(userId, "METAAPI");
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
  const { token, login, password, server, platform, name } = parsed.data;

  // Step 1: validate the token before sending sensitive MT creds.
  const t = await testToken(token);
  if (!t.ok) {
    return NextResponse.json({ error: t.error }, { status: 400 });
  }

  // Step 2: provision. This pings MetaApi with MT credentials. Do NOT
  // log `password` or `body` anywhere — it's the user's broker login.
  let accountId: string;
  try {
    accountId = await addAccount(token, {
      login,
      password,
      server,
      platform,
      name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json(
      { error: `MetaApi không tạo được account: ${msg}` },
      { status: 502 },
    );
  }

  // Step 3: persist. Only token + accountId. MT login/password gone.
  await saveCreds(userId, "METAAPI", { token, accountId });
  await setBrokerMeta(userId, "METAAPI", {
    accountId,
    server,
    platform,
    loginLast4: login.slice(-4),
    tokenMasked: maskSecret(token, 6),
    savedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, accountId, tokenMasked: maskSecret(token, 6) });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  // Best-effort: tell MetaApi to free the cloud terminal so they stop
  // billing. Even if this fails (token revoked, etc.), still remove
  // local rows — the user explicitly asked to disconnect.
  const creds = await loadCreds<MetaApiCreds>(userId, "METAAPI");
  if (creds) {
    try {
      await removeAccount(creds.token, creds.accountId);
    } catch {
      // ignore; local cleanup proceeds
    }
  }
  await deleteCreds(userId, "METAAPI");
  return NextResponse.json({ ok: true });
}
