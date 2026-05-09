import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tradePatchSchema } from "@/lib/journal/schema";
import { derivePnl, deriveRMultiple } from "@/lib/journal/derive";
import { serializeTrade } from "@/lib/journal/serialize";
import { resolveTagIds } from "@/lib/journal/tags";
import type {
  MarketType,
  Prisma,
  TradeDirection,
  TradeStatus,
} from "@/generated/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;
  const trade = await db.tradeJournal.findFirst({
    where: { id, userId: session.user.id },
    include: {
      screenshots: { orderBy: { createdAt: "asc" } },
      tags: { include: { tag: true } },
      strategy: true,
      account: true,
    },
  });
  if (!trade) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  return NextResponse.json({
    ...serializeTrade(trade),
    screenshots: trade.screenshots.map((s) => ({
      id: s.id,
      url: s.url,
      caption: s.caption,
      kind: s.kind,
      createdAt: s.createdAt.toISOString(),
    })),
    tags: trade.tags.map((tt) => ({
      id: tt.tag.id,
      name: tt.tag.name,
      color: tt.tag.color,
    })),
    strategy: trade.strategy
      ? { id: trade.strategy.id, name: trade.strategy.name }
      : null,
    account: trade.account
      ? {
          id: trade.account.id,
          name: trade.account.name,
          currency: trade.account.currency,
        }
      : null,
  });
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const existing = await db.tradeJournal.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  const parsed = tradePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }
  const input = parsed.data;

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

  // Effective fields after merge.
  const market: MarketType = input.market ?? (existing.market as MarketType);
  const direction: TradeDirection =
    input.direction ?? (existing.direction as TradeDirection);
  const status: TradeStatus = input.status ?? (existing.status as TradeStatus);

  const entryPrice =
    input.entryPrice ?? Number(existing.entryPrice.toString());
  const exitPrice =
    input.exitPrice !== undefined
      ? input.exitPrice
      : existing.exitPrice
        ? Number(existing.exitPrice.toString())
        : undefined;
  const lotSize = input.lotSize ?? Number(existing.lotSize.toString());
  const riskAmount =
    input.riskAmount !== undefined
      ? input.riskAmount
      : existing.riskAmount
        ? Number(existing.riskAmount.toString())
        : 0;

  // Compute pnl: if user supplied pnl explicitly, take it. Else, if status is
  // CLOSED + exitPrice is known, derive. Else keep existing.
  let pnl: number | null | undefined = undefined;
  if (input.pnl !== undefined) {
    pnl = input.pnl;
  } else if (status === "CLOSED" && exitPrice !== undefined) {
    pnl = derivePnl({
      market,
      direction,
      entryPrice,
      exitPrice,
      lotSize,
    });
  } else {
    pnl =
      existing.pnl !== null && existing.pnl !== undefined
        ? Number(existing.pnl.toString())
        : null;
  }

  const rMultiple =
    pnl !== null && pnl !== undefined && riskAmount > 0
      ? deriveRMultiple(pnl, riskAmount)
      : null;

  // Tags handling: if the client sends tagNames, replace the set.
  const tagsRewrite = input.tagNames
    ? await resolveTagIds(userId, input.tagNames)
    : null;

  const data: Prisma.TradeJournalUncheckedUpdateInput = {
    ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
    ...(input.market !== undefined ? { market: input.market } : {}),
    ...(input.direction !== undefined ? { direction: input.direction } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.timeframe !== undefined ? { timeframe: input.timeframe ?? null } : {}),
    ...(input.entryPrice !== undefined ? { entryPrice: input.entryPrice } : {}),
    ...(input.exitPrice !== undefined ? { exitPrice: input.exitPrice ?? null } : {}),
    ...(input.stopLoss !== undefined ? { stopLoss: input.stopLoss ?? null } : {}),
    ...(input.takeProfit !== undefined
      ? { takeProfit: input.takeProfit ?? null }
      : {}),
    ...(input.lotSize !== undefined ? { lotSize: input.lotSize } : {}),
    ...(input.riskAmount !== undefined ? { riskAmount: input.riskAmount } : {}),
    ...(input.feesAmount !== undefined
      ? { feesAmount: input.feesAmount ?? null }
      : {}),
    ...(input.openedAt !== undefined ? { openedAt: input.openedAt } : {}),
    ...(input.closedAt !== undefined
      ? { closedAt: input.closedAt ?? null }
      : status === "CLOSED" && existing.closedAt === null
        ? { closedAt: new Date() }
        : {}),
    ...(input.setup !== undefined ? { setup: input.setup ?? null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
    ...(input.mistakes !== undefined ? { mistakes: input.mistakes ?? null } : {}),
    ...(input.emotion !== undefined ? { emotion: input.emotion ?? null } : {}),
    ...(input.strategyId !== undefined
      ? { strategyId: input.strategyId ?? null }
      : {}),
    ...(input.accountId !== undefined
      ? { accountId: input.accountId ?? null }
      : {}),
    pnl: pnl ?? null,
    rMultiple: rMultiple ?? null,
  };

  try {
    await db.tradeJournal.update({
      where: { id },
      data,
    });

    if (tagsRewrite !== null) {
      await db.tradeJournalTag.deleteMany({ where: { tradeId: id } });
      if (tagsRewrite.length > 0) {
        await db.tradeJournalTag.createMany({
          data: tagsRewrite.map((tagId) => ({ tradeId: id, tagId })),
        });
      }
    }

    const fresh = await db.tradeJournal.findFirstOrThrow({
      where: { id, userId },
    });
    return NextResponse.json(serializeTrade(fresh));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cập nhật thất bại";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await db.tradeJournal.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  await db.tradeJournal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
