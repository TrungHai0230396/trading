import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { listOnchainReports } from "@/lib/onchain/service";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const data = await listOnchainReports({
    userId: session.user.id,
    cursor,
    limit: limit && Number.isFinite(limit) ? limit : undefined,
  });

  return NextResponse.json(data);
}
