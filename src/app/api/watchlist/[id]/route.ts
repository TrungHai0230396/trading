import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await db.watchlistSymbol.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  await db.watchlistSymbol.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
