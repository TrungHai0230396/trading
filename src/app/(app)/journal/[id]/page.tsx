import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { TradeFormClient } from "../trade-form-client";
import { serializeTrade } from "@/lib/journal/serialize";
import type { TradeDetail } from "@/lib/journal/types";

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    notFound();
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
    notFound();
  }

  const detail: TradeDetail = {
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
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${detail.symbol} • ${detail.direction}`}
        description={`${detail.market} · ${detail.status}`}
      />
      <TradeFormClient mode="edit" trade={detail} />
    </div>
  );
}
