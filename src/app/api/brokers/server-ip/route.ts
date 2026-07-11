/**
 * GET /api/brokers/server-ip — the app's public egress IP, shown in the
 * broker-key guides so users whitelist the right address. Auth-gated (no
 * reason to expose the server IP to the anonymous internet) and cheap:
 * the lookup itself is cached 10 minutes in lib/server-ip.ts.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getServerPublicIp } from "@/lib/server-ip";
import { rateLimit } from "@/lib/brokers/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  if (!rateLimit(`server-ip:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ ip: null }, { status: 429 });
  }

  return NextResponse.json({ ip: await getServerPublicIp() });
}
