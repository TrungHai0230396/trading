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
 * One render = one snapshot = ~7 fresh Binance calls, so the route carries
 * a per-user backstop throttle (see below) before it renders anything.
 *
 * Next 16 note: `params` is a Promise — must await before use.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ExternalLink, Hourglass, RotateCcw } from "lucide-react";

import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { rateLimit } from "@/lib/brokers/rate-limit";
import { tradingViewUrl } from "@/lib/scanner/tradingview";

import { DataCardsTop, DataCardsEvidence } from "./_components/data-cards";
import { AiCard } from "./_components/ai-card";
import { ActionBarShell } from "./_components/action-bar-shell";

export const runtime = "nodejs";

// ── Per-user backstop on the Binance fan-out ─────────────────────────
// Rendering this page fans out ~7 fresh Binance REST calls, all leaving
// from the ONE shared server IP. Without a ceiling, a signed-up user with
// a curl loop and their own session cookie can drive hundreds of requests
// per second and get that IP rate-limited or banned — which takes down
// prices, portfolio, live journal quotes and the shared consensus alerts
// for EVERY user, not just theirs.
//
// Sized generously ON PURPOSE. A trader flipping through the Top 10 must
// never see this; a human cannot read 30 deep-analysis pages in a minute.
// The real defence is the shared TTL cache in front of the Binance
// fetchers — this is only the backstop for when someone bypasses the UI.
//
// The same two keys are checked in the AI route (which builds the same
// snapshot), so alternating page loads and AI runs can't buy a user twice
// the Binance budget:
//   src/app/api/scanner/analysis/[market]/[symbol]/ai/route.ts
//
// NOTE: `rateLimit()` counts per-process. That is exact for this
// single-container deploy, but if the app is ever scaled to multiple
// replicas each one keeps its own counters and the effective ceiling
// multiplies by the replica count — move to a shared store before then.
const SNAPSHOT_BURST_MAX = 30;
const SNAPSHOT_BURST_MS = 60_000;
const SNAPSHOT_HOURLY_MAX = 300;
const SNAPSHOT_HOURLY_MS = 60 * 60_000;

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

  const userId = session.user.id;

  // Counted after the 404 guards (a bad symbol never reaches Binance, so it
  // shouldn't cost a slot) and keyed on the user id rather than the IP — a
  // shared office NAT or carrier CGNAT must not throttle innocent people.
  //
  // This does not fight Next's own traffic: the route is dynamic and has no
  // `loading.tsx`, so Next never prefetches its render (it would only warm
  // the loading boundary), and the scanner list links with `prefetch={false}`
  // anyway. One navigation = one render = one counted hit; the three Suspense
  // boundaries below share a single `cache()`d snapshot.
  //
  // Deliberately NOT a throw: nothing is broken, the user is just ahead of
  // the data budget, so render a calm state instead of a 500.
  const throttled =
    !rateLimit(
      `analysis-snap-m:${userId}`,
      SNAPSHOT_BURST_MAX,
      SNAPSHOT_BURST_MS,
    ) ||
    !rateLimit(
      `analysis-snap-h:${userId}`,
      SNAPSHOT_HOURLY_MAX,
      SNAPSHOT_HOURLY_MS,
    );
  if (throttled) return <ThrottledNotice symbol={symbol} />;

  // Snapshot is cached per-request; both Suspense boundaries reuse it.
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
        {/* Decision block: hero + your context + the plan. */}
        <Suspense fallback={<DataCardsSkeleton />}>
          <DataCardsTop args={snapshotArgs} />
        </Suspense>

        {/* AI narrative sits right under the plan it explains. User-
            triggered — no Suspense / no auto-fetch (saves Gemini quota). */}
        <AiCard market={typedMarket} symbol={symbol} />

        {/* Evidence: per-TF table, volume/structure, news. */}
        <Suspense fallback={<EvidenceSkeleton />}>
          <DataCardsEvidence args={snapshotArgs} />
        </Suspense>

        {/* Mobile-sticky / desktop-static action bar. Skeleton fallback:
            without it the sticky bar popped in seconds after first paint —
            layout shift right where the user decides to act. */}
        <Suspense fallback={<ActionBarSkeleton />}>
          <ActionBarShell args={snapshotArgs} />
        </Suspense>
      </div>
    </div>
  );
}

// ── throttled state ──────────────────────────────────────────────────

/**
 * Shown in place of the analysis when the per-user backstop trips.
 *
 * Kept visually distinct from `error.tsx`: that one is a warning (data
 * genuinely missing), this one is neutral — nothing failed, the user just
 * moved faster than the data budget. Keeping the PageHeader means they can
 * still see which coin they were on and get back out.
 */
function ThrottledNotice({ symbol }: { symbol: string }) {
  // Market is CRYPTO by the time we get here (others 404 above) and `symbol`
  // is already stripped to [A-Z0-9], so this href is safe to reflect back.
  const selfHref = `/scanner/analysis/crypto/${symbol}`;

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <PageHeader
        title={symbol}
        description="Phân tích đa khung & kế hoạch giao dịch — Crypto"
        actions={
          <Button variant="outline" size="sm" render={<Link href="/scanner" />}>
            <ChevronLeft className="size-4" />
            Quay lại
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Hourglass className="size-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Bạn xem hơi nhanh</h2>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Mỗi lần mở trang này, hệ thống kéo dữ liệu mới từ sàn. Nghỉ một
              lát rồi thử lại — tài khoản của bạn vẫn bình thường, không có gì
              hỏng cả.
            </p>
          </div>
          {/* Plain <a>, not <Link>: a hard reload guarantees a fresh server
              request. A client-side nav to the URL we're already on may be
              a no-op, which would look like the button is broken. */}
          <Button variant="outline" size="sm" render={<a href={selfHref} />}>
            <RotateCcw className="size-4" />
            Thử lại
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── skeletons ────────────────────────────────────────────────────────

function EvidenceSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ActionBarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-8 w-36 flex-1 md:flex-none" />
      ))}
    </div>
  );
}

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
