import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { saveDataUrl } from "@/lib/journal/screenshot-store";

// The upload still ARRIVES as a base64 data: URL (the form reads the file with
// FileReader), but it is written to a disk volume and only a short path is
// stored — see lib/journal/screenshot-store.ts for why the bytes must not live
// in MySQL. These caps bound what one account can push through:
//   - MAX_URL_LENGTH ~2M chars ≈ 1.5MB image (a chart PNG is well under)
//   - MAX_PER_TRADE: before/during/after across a couple TFs is plenty
//   - MAX_PER_USER: backstop against thousands of empty trades each
//     stuffed with images
const MAX_URL_LENGTH = 2_000_000;
const MAX_PER_TRADE = 8;
// Account-wide backstop against thousands of empty trades each stuffed with
// images. Sized so a genuine active journaler (before/during/after per trade)
// never hits it in normal use — deletions free the quota back up.
const MAX_PER_USER = 2000;
const ALLOWED_KINDS = ["before", "during", "after"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  // Blunt a scripted upload flood before touching the DB.
  if (!rateLimit(`screenshot:${userId}`, 30, 60_000)) {
    return NextResponse.json(
      { error: "Bạn đang tải ảnh quá nhanh. Thử lại sau ít phút." },
      { status: 429 },
    );
  }

  const { id } = await params;

  const trade = await db.tradeJournal.findFirst({
    where: { id, userId },
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
    return NextResponse.json(
      { error: "Ảnh quá lớn (tối đa ~1.5MB). Hãy nén ảnh nhỏ hơn hoặc dán URL." },
      { status: 400 },
    );
  }

  const isDataImage = trimmedUrl.startsWith("data:image/");
  const isHttp = trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://");
  if (!isDataImage && !isHttp) {
    return NextResponse.json({ error: "URL ảnh không hợp lệ" }, { status: 400 });
  }

  const finalKind = kind && ALLOWED_KINDS.includes(kind as (typeof ALLOWED_KINDS)[number])
    ? (kind as (typeof ALLOWED_KINDS)[number])
    : null;

  // Enforce per-trade and per-user ceilings. Not a transaction — a tiny
  // race could let two concurrent uploads both pass at the boundary, which
  // is harmless (off by one). The goal is bounding abuse, not exactness.
  const perTrade = await db.tradeScreenshot.count({ where: { tradeId: id } });
  if (perTrade >= MAX_PER_TRADE) {
    return NextResponse.json(
      { error: `Mỗi lệnh chỉ đính tối đa ${MAX_PER_TRADE} ảnh.` },
      { status: 400 },
    );
  }
  const perUser = await db.tradeScreenshot.count({
    where: { trade: { userId } },
  });
  if (perUser >= MAX_PER_USER) {
    return NextResponse.json(
      { error: `Đã đạt giới hạn ${MAX_PER_USER} ảnh cho tài khoản.` },
      { status: 400 },
    );
  }

  // Write the bytes to disk; the row keeps a path. A remote http(s) URL is
  // stored as-is — there is nothing of ours to save.
  let storedUrl = trimmedUrl;
  if (isDataImage) {
    const saved = await saveDataUrl(trimmedUrl, userId);
    if (!saved) {
      return NextResponse.json(
        { error: "Định dạng ảnh không hỗ trợ (chỉ png, jpg, webp, gif)." },
        { status: 400 },
      );
    }
    storedUrl = saved.url;
  }

  try {
    const shot = await db.tradeScreenshot.create({
      data: {
        tradeId: id,
        url: storedUrl,
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
