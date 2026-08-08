import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteStoredFile } from "@/lib/journal/screenshot-store";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; screenshotId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id, screenshotId } = await params;

  const shot = await db.tradeScreenshot.findFirst({
    where: {
      id: screenshotId,
      tradeId: id,
      trade: { userId: session.user.id },
    },
    select: { id: true, url: true },
  });

  if (!shot) {
    return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });
  }

  await db.tradeScreenshot.delete({ where: { id: screenshotId } });
  // After the row is gone, so a failed unlink can never leave a row pointing
  // at a file that no longer exists. The reverse — a file with no row — only
  // wastes disk.
  await deleteStoredFile(shot.url, session.user.id);

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; screenshotId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id, screenshotId } = await params;

  const shot = await db.tradeScreenshot.findFirst({
    where: {
      id: screenshotId,
      tradeId: id,
      trade: { userId: session.user.id },
    },
    select: { id: true },
  });

  if (!shot) {
    return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }

  const { caption, kind } = body as {
    caption?: string | null;
    kind?: string | null;
  };

  const allowedKinds = ["before", "during", "after"] as const;
  const finalKind = kind && allowedKinds.includes(kind as (typeof allowedKinds)[number])
    ? (kind as (typeof allowedKinds)[number])
    : null;

  const updated = await db.tradeScreenshot.update({
    where: { id: screenshotId },
    data: {
      caption: caption?.trim() ? caption.trim() : null,
      kind: finalKind,
    },
  });

  return NextResponse.json({
    id: updated.id,
    url: updated.url,
    caption: updated.caption,
    kind: updated.kind,
    createdAt: updated.createdAt.toISOString(),
  });
}
