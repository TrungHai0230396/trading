/**
 * GET /api/journal/[id]/broker-orders
 *
 * Return all BrokerOrder rows associated with one journal entry.
 * Used by the journal detail page to render the "Lệnh thật trên Bitget"
 * panel + Cancel button.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const journal = await db.tradeJournal.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!journal) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  const orders = await db.brokerOrder.findMany({
    where: { tradeJournalId: id, userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      broker: true,
      status: true,
      side: true,
      orderType: true,
      symbol: true,
      size: true,
      price: true,
      presetStopLoss: true,
      presetTakeProfit: true,
      leverage: true,
      externalOrderId: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ orders });
}
