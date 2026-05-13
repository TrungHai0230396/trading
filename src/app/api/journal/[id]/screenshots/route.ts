import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const MAX_URL_LENGTH = 6_000_000;
const ALLOWED_KINDS = ["before", "during", "after"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;

  const trade = await db.tradeJournal.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!trade) {
    return NextResponse.json({ error: "Không tìm thấy lệnh" }, { status: 404 });
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

  const { url, caption, kind } = body as {
    url?: string;
    caption?: string | null;
    kind?: string | null;
  };

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return NextResponse.json({ error: "Thiếu URL ảnh" }, { status: 400 });
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "Ảnh quá lớn" }, { status: 400 });
  }

  const isDataImage = trimmedUrl.startsWith("data:image/");
  const isHttp = trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://");
  if (!isDataImage && !isHttp) {
    return NextResponse.json({ error: "URL ảnh không hợp lệ" }, { status: 400 });
  }

  const finalKind = kind && ALLOWED_KINDS.includes(kind as (typeof ALLOWED_KINDS)[number])
    ? (kind as (typeof ALLOWED_KINDS)[number])
    : null;

  try {
    const shot = await db.tradeScreenshot.create({
      data: {
        tradeId: id,
        url: trimmedUrl,
        caption: caption?.trim() ? caption.trim() : null,
        kind: finalKind,
      },
    });

    return NextResponse.json({
      id: shot.id,
      url: shot.url,
      caption: shot.caption,
      kind: shot.kind,
      createdAt: shot.createdAt.toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Không thể lưu ảnh. Ảnh có thể quá lớn — hãy thử ảnh nhỏ hơn hoặc dùng URL.",
      },
      { status: 500 },
    );
  }
}
