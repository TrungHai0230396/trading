import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/brokers/rate-limit";
import {
  MAX_ROWS_PER_FILE,
  MAX_TRADES_PER_FILE,
  parseMtHtml,
} from "@/lib/journal/mt-import";

// A genuine MT4/MT5 "Detailed Report" for a full year is well under a
// megabyte; 5MB is already generous. The raw-body ceiling is a little
// higher because JSON escaping / multipart framing wrap the file.
const MAX_HTML_CHARS = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 6 * 1024 * 1024;

// Importing is a once-in-a-while action, and every call costs us a full
// parse of an attacker-supplied document. Keep it tight.
const MAX_PREVIEWS_PER_HOUR = 10;

/**
 * Read the request body with a hard byte ceiling, cancelling the stream the
 * moment it is crossed.
 *
 * `Content-Length` is client-supplied and proves nothing, and `req.json()` /
 * `req.formData()` buffer the ENTIRE body before we get a chance to look at
 * it — so checking the size after them is too late: a single 500MB POST
 * would be an out-of-memory, not a 413. This app is one Node process, so
 * that outage would hit every user at once.
 *
 * Returns `null` when the ceiling is exceeded.
 */
async function readBodyBounded(
  req: Request,
  maxBytes: number,
  // Uint8Array<ArrayBuffer>, not the default Uint8Array<ArrayBufferLike>:
  // everything we return is allocated by `new Uint8Array(total)` below, so the
  // buffer is never a SharedArrayBuffer — and only the narrow form is accepted
  // as a BodyInit when we re-wrap the bytes in a Response.
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function tooLarge() {
  return NextResponse.json(
    {
      error:
        "Tệp vượt quá 5MB. Hãy xuất lại báo cáo cho khoảng thời gian ngắn hơn.",
    },
    { status: 413 },
  );
}

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
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  // Gate before we read a single byte — parsing is the expensive part.
  if (!rateLimit(`import-preview:${userId}`, MAX_PREVIEWS_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json(
      { error: "Bạn tải tệp lên quá nhiều lần. Thử lại sau ít phút." },
      { status: 429 },
    );
  }

  const ctype = req.headers.get("content-type") ?? "";
  if (
    !ctype.includes("multipart/form-data") &&
    !ctype.includes("application/json")
  ) {
    return NextResponse.json(
      { error: "Content-Type không hỗ trợ" },
      { status: 415 },
    );
  }

  const raw = await readBodyBounded(req, MAX_BODY_BYTES);
  if (raw === null) return tooLarge();

  let html: string;
  try {
    if (ctype.includes("multipart/form-data")) {
      // The body is already buffered and bounded, so re-wrap it to reuse the
      // platform multipart parser instead of re-reading the request.
      const form = await new Response(raw, {
        headers: { "content-type": ctype },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: "Thiếu tệp HTML" }, { status: 400 });
      }
      html = await file.text();
    } else {
      const body = JSON.parse(new TextDecoder().decode(raw)) as {
        html?: unknown;
      };
      if (typeof body?.html !== "string") {
        return NextResponse.json(
          { error: "Thiếu trường html" },
          { status: 400 },
        );
      }
      html = body.html;
    }
  } catch {
    return NextResponse.json({ error: "Không đọc được tệp" }, { status: 400 });
  }

  if (html.length > MAX_HTML_CHARS) return tooLarge();

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

  // The parser stopped early. Refuse the whole file instead of returning a
  // partial history: importing 500 of 900 trades would quietly corrupt every
  // statistic the journal computes, and the user would never know.
  if (result.truncated) {
    return NextResponse.json(
      {
        error: `Tệp có quá nhiều dữ liệu (tối đa ${MAX_TRADES_PER_FILE.toLocaleString("vi-VN")} lệnh / ${MAX_ROWS_PER_FILE.toLocaleString("vi-VN")} dòng mỗi lần nhập). Hãy xuất báo cáo theo từng khoảng thời gian ngắn hơn rồi nhập lần lượt.`,
      },
      { status: 413 },
    );
  }

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
