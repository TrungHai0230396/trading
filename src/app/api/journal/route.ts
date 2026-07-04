import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  tradeListQuerySchema,
  tradeUpsertSchema,
} from "@/lib/journal/schema";
import { derivePnl, deriveRMultiple } from "@/lib/journal/derive";
import { serializeTrade } from "@/lib/journal/serialize";
import { resolveTagIds } from "@/lib/journal/tags";
import type { Prisma } from "@/generated/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = tradeListQuerySchema.safeParse({
    market: url.searchParams.get("market") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    direction: url.searchParams.get("direction") ?? undefined,
    symbol: url.searchParams.get("symbol") ?? undefined,
    strategyId: url.searchParams.get("strategyId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Query không hợp lệ" },
      { status: 400 },
    );
  }

  const q = parsed.data;
  const limit = q.limit ?? 50;
  const userId = session.user.id;

  const where: Prisma.TradeJournalWhereInput = {
    userId,
    ...(q.market ? { market: q.market } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.direction ? { direction: q.direction } : {}),
    ...(q.strategyId ? { strategyId: q.strategyId } : {}),
    ...(q.symbol
      ? { symbol: { contains: q.symbol.toUpperCase() } }
      : {}),
    ...(q.from || q.to
      ? {
          openedAt: {
            ...(q.from ? { gte: q.from } : {}),
            ...(q.to ? { lte: q.to } : {}),
          },
        }
      : {}),
  };

  const items = await db.tradeJournal.findMany({
    where,
    orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const slice = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

  return NextResponse.json({
    items: slice.map(serializeTrade),
    nextCursor,
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

  const parsed = tradeUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const userId = session.user.id;

  // Validate strategy/account ownership if provided.
  if (input.strategyId) {
    const ok = await db.strategy.findFirst({
      where: { id: input.strategyId, userId },
      select: { id: true },
    });
    if (!ok) {
      return NextResponse.json(
        { error: "Strategy không tồn tại" },
        { status: 400 },
      );
    }
  }
  if (input.accountId) {
    const ok = await db.tradingAccount.findFirst({
      where: { id: input.accountId, userId },
      select: { id: true },
    });
    if (!ok) {
      return NextResponse.json(
        { error: "Tài khoản không tồn tại" },
        { status: 400 },
      );
    }
  }
  if (input.tradingSystemId) {
    const ok = await db.tradingSystem.findFirst({
      where: { id: input.tradingSystemId, userId },
      select: { id: true },
    });
    if (!ok) {
      return NextResponse.json(
        { error: "Hệ thống giao dịch không tồn tại" },
        { status: 400 },
      );
    }
  }

  // Compute derived values.
  let pnl = input.pnl;
  if (
    pnl === undefined &&
    input.status === "CLOSED" &&
    input.exitPrice !== undefined
  ) {
    pnl = derivePnl({
      market: input.market,
      direction: input.direction,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice,
      lotSize: input.lotSize,
    });
  }
  const rMultiple =
    pnl !== undefined && input.riskAmount > 0
      ? deriveRMultiple(pnl, input.riskAmount)
      : null;

  const closedAt =
    input.closedAt ?? (input.status === "CLOSED" ? new Date() : undefined);

  // Resolve tag IDs (create on the fly).
  const tagConnect = input.tagNames?.length
    ? await resolveTagIds(userId, input.tagNames)
    : [];

  try {
    const created = await db.tradeJournal.create({
      data: {
        userId,
        symbol: input.symbol,
        market: input.market,
        direction: input.direction,
        status: input.status,
        timeframe: input.timeframe,
        entryPrice: input.entryPrice,
        exitPrice: input.exitPrice ?? null,
        stopLoss: input.stopLoss ?? null,
        takeProfit: input.takeProfit ?? null,
        lotSize: input.lotSize,
        riskAmount: input.riskAmount,
        pnl: pnl ?? null,
        rMultiple: rMultiple ?? null,
        feesAmount: input.feesAmount ?? null,
        openedAt: input.openedAt,
        closedAt: closedAt ?? null,
        setup: input.setup ?? null,
        notes: input.notes ?? null,
        mistakes: input.mistakes ?? null,
        emotion: input.emotion ?? null,
        ...(input.strategyId ? { strategyId: input.strategyId } : {}),
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(input.tradingSystemId
          ? { tradingSystemId: input.tradingSystemId }
          : {}),
        ...(input.systemChecks
          ? { systemChecks: input.systemChecks }
          : {}),
        ...(tagConnect.length
          ? {
              tags: {
                create: tagConnect.map((tagId) => ({ tagId })),
              },
            }
          : {}),
      },
    });

    return NextResponse.json(serializeTrade(created), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Tạo lệnh thất bại";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

