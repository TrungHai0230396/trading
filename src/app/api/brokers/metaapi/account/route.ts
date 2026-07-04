import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { loadCreds } from "@/lib/brokers/store";
import {
  getBalance,
  getPositions,
  type MetaApiCreds,
} from "@/lib/brokers/metaapi";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const creds = await loadCreds<MetaApiCreds>(session.user.id, "METAAPI");
  if (!creds) {
    return NextResponse.json(
      { error: "Chưa kết nối MetaApi" },
      { status: 404 },
    );
  }

  try {
    const [balance, positions] = await Promise.all([
      getBalance(creds),
      getPositions(creds),
    ]);
    return NextResponse.json({ balance, positions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
