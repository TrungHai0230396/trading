import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getOnchainReport } from "@/lib/onchain/service";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const report = await getOnchainReport({ userId: session.user.id, id });
  if (!report) {
    return NextResponse.json(
      { error: "Không tìm thấy báo cáo" },
      { status: 404 },
    );
  }
  return NextResponse.json(report);
}
