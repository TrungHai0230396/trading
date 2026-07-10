import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeSymbol } from "@/lib/insights/curated";

// Crypto-only: the scanner (on-demand + consensus cron) no longer covers
// forex, so nothing forex should enter the watchlist either.
const marketEnum = z.enum(["CRYPTO"]);

const listQuerySchema = z.object({
  market: marketEnum,
});

const createSchema = z.object({
  market: marketEnum,
  symbol: z
    .string()
    .min(2, "Symbol quá ngắn")
    .max(20, "Symbol quá dài")
    .transform((v) => normalizeSymbol(v))
    .refine((v) => v.length >= 2, "Symbol không hợp lệ"),
  exchange: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

function serialize(row: {
  id: string;
  symbol: string;
  market: string;
  exchange: string | null;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    symbol: row.symbol,
    market: row.market,
    exchange: row.exchange,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    market: url.searchParams.get("market") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Query không hợp lệ" },
      { status: 400 },
    );
  }

  const rows = await db.watchlistSymbol.findMany({
    where: { userId: session.user.id, market: parsed.data.market },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    items: rows.map(serialize),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const userId = session.user.id;
  const data = parsed.data;

  try {
    // Idempotent: re-adding the same symbol just returns the existing row.
    const existing = await db.watchlistSymbol.findFirst({
      where: {
        userId,
        symbol: data.symbol,
        market: data.market,
      },
    });
    if (existing) {
      return NextResponse.json(serialize(existing), { status: 200 });
    }

    const created = await db.watchlistSymbol.create({
      data: {
        userId,
        symbol: data.symbol,
        market: data.market,
        exchange: data.exchange ?? null,
        notes: data.notes ?? null,
      },
    });
    return NextResponse.json(serialize(created), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Tạo watchlist thất bại";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
