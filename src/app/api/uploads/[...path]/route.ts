/**
 * Serves a user's chart screenshots from disk.
 *
 * Deliberately an authenticated route rather than a static folder: a trade
 * screenshot shows someone's positions and P&L, and while the file name is
 * unguessable, "unguessable" is not an access control. The stored path carries
 * the owner's id, so the check is a string comparison against the session — no
 * DB round-trip on an image request.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readStoredFile, resolveStoredFile } from "@/lib/journal/screenshot-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { path: segments } = await params;
  const resolved = resolveStoredFile(
    `/api/uploads/${segments.join("/")}`,
    userId,
  );
  // Same 404 for "malformed", "not yours" and "missing": telling the two apart
  // would confirm which files exist for other accounts.
  if (!resolved) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  const bytes = await readStoredFile(resolved.absPath);
  if (!bytes) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": resolved.mime,
      // Immutable: the filename is a fresh uuid per upload, so the bytes at a
      // given path never change. `private` keeps it out of shared caches.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(bytes.length),
    },
  });
}
