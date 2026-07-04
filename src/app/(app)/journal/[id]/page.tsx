import { notFound } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { TradeFormClient } from "../trade-form-client";
import { BrokerOrderPanel } from "../broker-order-panel";
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
      tradingSystem: { select: { id: true, name: true } },
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
    tradingSystem: trade.tradingSystem
      ? { id: trade.tradingSystem.id, name: trade.tradingSystem.name }
      : null,
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${detail.symbol} • ${detail.direction}`}
        description={`${detail.market} · ${detail.status}`}
      />
      {/* Suspense required because TradeFormClient uses useSearchParams
          (Next 16). Edit mode ignores the params, but the hook still
          runs unconditionally. */}
      <div className="space-y-4">
        <BrokerOrderPanel tradeJournalId={detail.id} />
        <Suspense fallback={null}>
          <TradeFormClient mode="edit" trade={detail} />
        </Suspense>
      </div>
    </div>
  );
}
