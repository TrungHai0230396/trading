/**
 * Chart screenshots on disk instead of inside MySQL.
 *
 * They used to be stored as base64 `data:` URLs in TradeScreenshot.url
 * (@db.LongText), which meant the image itself lived in the database: base64
 * inflates the bytes by a third, every nightly dump copied every image, and a
 * few active journalers would have grown the DB — and each backup — by
 * gigabytes. Now the bytes go to a volume and the row keeps a short path.
 *
 * PRIVACY: a trade screenshot is private user data, so files are NOT served as
 * public static assets. The path embeds the owner's id and /api/uploads checks
 * the session against it — an O(1) check with no DB round-trip, and a leaked
 * path is still useless to anyone else.
 *
 * Old rows keep working: `data:` and `http(s)` URLs are passed through
 * untouched, so nothing has to be migrated for the app to keep rendering.
 */

import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Container path; a Docker volume keeps it across image rebuilds. */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";

/** Public route that serves these files, auth-checked. */
const SERVE_PREFIX = "/api/uploads";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Ids and filenames we will touch on disk — nothing else, ever. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_FILE = /^[A-Za-z0-9_-]{1,64}\.(png|jpg|webp|gif)$/;

export function isStoredPath(url: string): boolean {
  return url.startsWith(`${SERVE_PREFIX}/`);
}

/**
 * Resolve a stored path to a real file, or null if it is malformed or points
 * anywhere but this user's own folder.
 *
 * Every segment is validated against a strict allowlist BEFORE being joined,
 * so "..", absolute paths and encoded traversal can never reach the join.
 */
export function resolveStoredFile(
  url: string,
  expectUserId: string,
): { absPath: string; mime: string } | null {
  if (!isStoredPath(url)) return null;
  const rest = url.slice(SERVE_PREFIX.length + 1);
  const [userId, file, ...extra] = rest.split("/");
  if (extra.length > 0) return null;
  if (!userId || !file) return null;
  if (!SAFE_SEGMENT.test(userId) || !SAFE_FILE.test(file)) return null;
  if (userId !== expectUserId) return null;

  const ext = file.split(".").pop() as string;
  return {
    absPath: path.join(UPLOAD_DIR, userId, file),
    mime: EXT_MIME[ext] ?? "application/octet-stream",
  };
}

/**
 * Write a `data:image/...;base64,...` payload to disk and return the path to
 * store on the row. Returns null when the payload is not an image data URL —
 * the caller then treats the value as a plain remote URL.
 */
export async function saveDataUrl(
  dataUrl: string,
  userId: string,
): Promise<{ url: string; bytes: number } | null> {
  // [\s\S] instead of the /s flag — tsconfig targets below es2018.
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) return null;

  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return null;

  const dir = path.join(UPLOAD_DIR, userId);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, name), bytes);

  return { url: `${SERVE_PREFIX}/${userId}/${name}`, bytes: bytes.length };
}

export async function readStoredFile(absPath: string): Promise<Buffer | null> {
  try {
    return await readFile(absPath);
  } catch {
    return null;
  }
}

/**
 * Best-effort delete of the file behind a row. Never throws: the row is the
 * source of truth, and an orphaned file wastes disk but breaks nothing —
 * whereas failing the user's delete because of it would.
 */
export async function deleteStoredFile(
  url: string,
  userId: string,
): Promise<void> {
  const resolved = resolveStoredFile(url, userId);
  if (!resolved) return;
  try {
    await unlink(resolved.absPath);
  } catch {
    // already gone, or never written
  }
}
