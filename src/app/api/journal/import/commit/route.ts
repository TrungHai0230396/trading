import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/brokers/rate-limit";

// A public user could otherwise loop this endpoint to insert millions of
// fabricated rows into MySQL (and every nightly backup). Bound it three ways.
const MAX_TRADES_PER_BATCH = 500;
const MAX_IMPORTS_PER_HOUR = 5;
const MAX_TRADES_PER_USER = 20_000;

// Trade payload coming back from the preview step. Dates arrive as ISO
// strings via JSON; the rest mirror `ParsedTrade` from the parser.
const tradeSchema = z.object({
  externalTicket: z.string().trim().min(1).max(64),
  symbol: z.string().trim().min(1).max(40),
  market: z.enum(["FOREX", "CRYPTO", "OTHER"]),
  direction: z.enum(["LONG", "SHORT"]),
  lotSize: z.number().positive(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  openedAt: z.string().min(1),
  closedAt: z.string().min(1),
  pnl: z.number(),
  commission: z.number().optional(),
  swap: z.number().optional(),
  comment: z.string().max(2000).optional(),
});

const bodySchema = z.object({
  trades: z.array(tradeSchema).min(1).max(MAX_TRADES_PER_BATCH),
  accountId: z.string().trim().min(1).max(64).optional().nullable(),
  dedupe: z.boolean().default(true),
});

type CommitTrade = z.infer<typeof tradeSchema>;

function buildNotes(t: CommitTrade): string {
  const parts: string[] = [
    `Imported from MT ticket #${t.externalTicket}.`,
  ];
  if (t.commission !== undefined) parts.push(`Commission ${t.commission}`);
  if (t.swap !== undefined) parts.push(`Swap ${t.swap}`);
  if (t.comment) parts.push(`Comment: ${t.comment}`);
  return parts.join(" ");
}

/**
 * Map import-only markets to the broader `MarketType` enum the schema
 * uses. The parser only produces FOREX / CRYPTO / OTHER — anything
 * stranger is OTHER.
 */
function toSchemaMarket(m: CommitTrade["market"]) {
  return m; // happens to be a subset of MarketType
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!rateLimit(`import:${userId}`, MAX_IMPORTS_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json(
      { error: "Bạn nhập lệnh quá nhiều lần. Thử lại sau ít phút." },
      { status: 429 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const { trades, accountId, dedupe } = parsed.data;

  // Hard ceiling on total journal rows per user — a backstop against
  // scripted bulk-insert bloat that the per-batch + per-hour caps alone
  // wouldn't stop over many hours.
  const existingCount = await db.tradeJournal.count({ where: { userId } });
  if (existingCount + trades.length > MAX_TRADES_PER_USER) {
    return NextResponse.json(
      {
        error: `Vượt giới hạn ${MAX_TRADES_PER_USER.toLocaleString("vi-VN")} lệnh cho tài khoản. Hãy xoá bớt lệnh cũ trước khi nhập thêm.`,
      },
      { status: 400 },
    );
  }

  // Validate account ownership if specified.
  let resolvedAccountId: string | null = null;
  if (accountId) {
    const ok = await db.tradingAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (!ok) {
      return NextResponse.json(
        { error: "Tài khoản không tồn tại" },
        { status: 400 },
      );
    }
    resolvedAccountId = accountId;
  }

  let inserted = 0;
  let skipped = 0;
  const errors: { ticket: string; message: string }[] = [];

  for (const t of trades) {
    const symbol = t.symbol.toUpperCase();
    const openedAt = new Date(t.openedAt);
    const closedAt = new Date(t.closedAt);
    if (
      Number.isNaN(openedAt.getTime()) ||
      Number.isNaN(closedAt.getTime())
    ) {
      errors.push({
        ticket: t.externalTicket,
        message: "Thời gian không hợp lệ",
      });
      continue;
    }

    if (dedupe) {
      // Soft dedupe key: we don't have a unique index on ticket, so
      // composite (userId, symbol, openedAt, lotSize, direction) is the
      // best proxy for "same trade as before".
      const existing = await db.tradeJournal.findFirst({
        where: {
          userId,
          symbol,
          openedAt,
          direction: t.direction,
          lotSize: t.lotSize,
        },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
    }

    const fees =
      (t.commission ?? 0) + (t.swap ?? 0) === 0
        ? null
        : (t.commission ?? 0) + (t.swap ?? 0);

    try {
      await db.tradeJournal.create({
        data: {
          userId,
          accountId: resolvedAccountId,
          symbol,
          market: toSchemaMarket(t.market),
          direction: t.direction,
          status: "CLOSED",
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          stopLoss: t.stopLoss ?? null,
          takeProfit: t.takeProfit ?? null,
          lotSize: t.lotSize,
          // An MT statement never says what the trader was risking, and a
          // stop loss alone doesn't say it either (it may have been moved).
          // null is that fact; 0 would read as "risked nothing".
          riskAmount: null,
          pnl: t.pnl,
          rMultiple: null, // no riskAmount → no honest R for these rows
          feesAmount: fees,
          openedAt,
          closedAt,
          notes: buildNotes(t),
        },
      });
      inserted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lưu lệnh thất bại";
      errors.push({ ticket: t.externalTicket, message: msg });
    }
  }

  return NextResponse.json({ inserted, skipped, errors });
}
