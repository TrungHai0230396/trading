import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseMtHtml } from "@/lib/journal/mt-import";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * POST /api/journal/import/preview
 *
 * Accepts either:
 *   - multipart/form-data with a `file` field (the HTML report)
 *   - application/json `{ html: string }`
 *
 * Returns the parsed trades (the list is small enough to ship in full
 * for the preview step).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const ctype = req.headers.get("content-type") ?? "";

  let html: string;
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json(
          { error: "Thiếu tệp HTML" },
          { status: 400 },
        );
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: "Tệp vượt quá 5MB" },
          { status: 413 },
        );
      }
      html = await file.text();
    } else if (ctype.includes("application/json")) {
      const body = (await req.json()) as { html?: unknown };
      if (typeof body?.html !== "string") {
        return NextResponse.json(
          { error: "Thiếu trường html" },
          { status: 400 },
        );
      }
      if (body.html.length > MAX_BYTES) {
        return NextResponse.json(
          { error: "Tệp vượt quá 5MB" },
          { status: 413 },
        );
      }
      html = body.html;
    } else {
      return NextResponse.json(
        { error: "Content-Type không hỗ trợ" },
        { status: 415 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Không đọc được tệp";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const trimmed = html.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Tệp rỗng" }, { status: 400 });
  }
  if (!/<table/i.test(trimmed)) {
    return NextResponse.json(
      { error: "Tệp không chứa bảng giao dịch" },
      { status: 400 },
    );
  }

  const result = parseMtHtml(trimmed);

  return NextResponse.json({
    broker: result.broker,
    parsed: result.trades.length,
    skipped: result.skipped,
    trades: result.trades.map((t) => ({
      ...t,
      openedAt: t.openedAt.toISOString(),
      closedAt: t.closedAt.toISOString(),
    })),
  });
}
