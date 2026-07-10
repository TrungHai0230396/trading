/**
 * Per-coin deep-analysis page — opened from the scanner Top 10 list.
 *
 * Layout: page shell paints immediately; two Suspense boundaries stream:
 *   1. Data cards (price, TA, volume, plan, S/R, news) — ~2-3s
 *   2. AI narrative — ~5-15s (can fail without breaking the rest)
 *
 * Both boundaries share the SAME snapshot via `getCachedAnalysisSnapshot`
 * (React `cache()` — deduped within one request). The AI shell awaits
 * the snapshot first then runs Gemini on top.
 *
 * Next 16 note: `params` is a Promise — must await before use.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ExternalLink } from "lucide-react";

import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { tradingViewUrl } from "@/lib/scanner/tradingview";

import { DataCards } from "./_components/data-cards";
import { AiCard } from "./_components/ai-card";
import { ActionBarShell } from "./_components/action-bar-shell";

export const runtime = "nodejs";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ market: string; symbol: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { market: rawMarket, symbol: rawSymbol } = await params;
  const market = rawMarket.toUpperCase();
  // Crypto-only scanner — forex analysis pages 404.
  if (market !== "CRYPTO") notFound();
  const symbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 3) notFound();

  // Snapshot is cached per-request; both Suspense boundaries reuse it.
  const userId = session.user.id;
  const typedMarket = market as "CRYPTO" | "FOREX";
  const snapshotArgs = [
    userId,
    typedMarket,
    symbol,
    undefined,
    undefined,
  ] as const;

  // Default chart timeframe = 1h (most useful intraday view). User can
  // pick a different TF on TradingView once they're there.
  const chartUrl = tradingViewUrl({
    symbol,
    market: typedMarket,
    timeframe: "1h",
  });

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <PageHeader
        title={symbol}
        description={`Phân tích đa khung & kế hoạch giao dịch — ${typedMarket === "CRYPTO" ? "Crypto" : "Forex"}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  href={chartUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Mở chart TradingView (tab mới)"
                />
              }
            >
              <ExternalLink className="size-4" />
              Mở chart
            </Button>
            <Button variant="outline" size="sm" render={<Link href="/scanner" />}>
              <ChevronLeft className="size-4" />
              Quay lại
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        <Suspense fallback={<DataCardsSkeleton />}>
          <DataCards args={snapshotArgs} />
        </Suspense>

        {/* AI is now user-triggered — no Suspense / no auto-fetch.
            Saves Gemini quota and avoids 503 blocking page load. */}
        <AiCard market={typedMarket} symbol={symbol} />

        {/* Mobile-sticky / desktop-static action bar — placed at the
            very bottom so it doesn't sandwich between content cards. */}
        <Suspense fallback={null}>
          <ActionBarShell args={snapshotArgs} />
        </Suspense>
      </div>
    </div>
  );
}

// ── skeletons ────────────────────────────────────────────────────────

function DataCardsSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// (No AI skeleton here — ai-card.tsx is a client component that
// owns its own loading state since it's user-triggered.)
