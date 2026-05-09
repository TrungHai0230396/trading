import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listNews, listNewsSources } from "@/lib/news/service";

const SENTIMENTS = ["bullish", "bearish", "neutral"] as const;
const IMPACTS = ["high", "medium", "low"] as const;

const querySchema = z.object({
  sentiment: z.enum(SENTIMENTS).optional(),
  impact: z.enum(IMPACTS).optional(),
  source: z.string().min(1).max(120).optional(),
  q: z.string().min(1).max(120).optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function readParam(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key);
  if (v == null || v === "" || v === "all") return undefined;
  return v;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    sentiment: readParam(url, "sentiment"),
    impact: readParam(url, "impact"),
    source: readParam(url, "source"),
    q: readParam(url, "q"),
    cursor: readParam(url, "cursor"),
    limit: readParam(url, "limit"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Query không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const [list, sources] = await Promise.all([
      listNews({ userId: session.user.id, ...parsed.data }),
      listNewsSources(session.user.id),
    ]);
    return NextResponse.json({ ...list, sources });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
