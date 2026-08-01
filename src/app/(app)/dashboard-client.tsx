"use client";

/**
 * Tổng quan — the live dashboard.
 *
 * Layout hierarchy (money first — this is a trading cockpit):
 *   1. HERO: Tổng tài sản — grand total + per-broker spot/futures columns.
 *      Four explicit states: skeleton / loaded / stale-error / connect-CTA.
 *   2. Positions strip — pills, only when something is actually open.
 *   3. Compact stat strip (journal performance, sample-size guarded).
 *   4. Equity curve (2/3) + right rail: latest scan, news.
 *
 * Data sources on independent clocks:
 *   - /api/dashboard (local DB aggregate)      → 60s
 *   - /api/brokers/portfolio (exchange, cached) → 2m — THROWS on !ok so
 *     react-query keeps last-good data instead of blanking the hero.
 *   - /api/brokers/bitget/account (positions)   → 60s, null when absent
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Activity,
  ChevronRight,
  Newspaper,
  Radar,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types (mirror /api/dashboard + /api/brokers/*)
// ──────────────────────────────────────────────────────────────────────
type DashboardData = {
  currency: string;
  stats: {
    todayPnl: number;
    openCount: number;
    closed30: number;
    winRate30: number | null;
    avgR30: number | null;
  };
  equitySeries: Array<{ t: string; equity: number }>;
  latestRun: {
    id: string;
    createdAt: string;
    market: string;
    top: Array<{ symbol: string; signal: string; score: number | null }>;
  } | null;
};

type BitgetAccount = {
  balance: {
    marginCoin: string;
    equity: number | null;
    available: number | null;
    unrealizedPnl: number | null;
  };
  positions: Array<{
    symbol: string;
    side: "long" | "short";
    size: number | null;
    leverage: number | null;
    unrealizedPnl: number | null;
  }>;
};

type NewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: string | null;
};

type Portfolio = {
  brokers: Array<{
    broker: "BITGET" | "BINANCE" | "MEXC" | "OKX";
    spot: {
      totalUsd: number;
      assets: Array<{ coin: string; total: number; usdValue: number }>;
      otherCount: number;
      otherUsd: number;
      dustCount: number;
      unpricedCount: number;
      error?: string;
    };
    futures: {
      equity: number;
      available: number;
      unrealizedPnl: number;
      error?: string;
    };
  }>;
  totals: {
    spotUsd: number;
    futuresUsd: number;
    totalUsd: number;
    unrealizedPnl: number;
  };
  fetchedAt: string;
};

const fmt = (n: number | null | undefined, dp = 2): string =>
  typeof n === "number" && Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      }).format(n)
    : "—";

// Performance stats from a handful of trades scream (a lone red -1.06R was
// the loudest number on the page). Below this many closed trades we show
// "—" instead of pretending the sample means something.
const MIN_SAMPLE = 5;

export function DashboardClient() {
  const dash = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/dashboard", { signal });
      if (!res.ok) throw new Error("Không tải được số liệu");
      return (await res.json()) as DashboardData;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Compact news feed — a cron keeps the table fresh; 3 items is enough
  // for a rail card (5 made the rail longer than the chart).
  const news = useQuery<{ items: NewsItem[] }>({
    queryKey: ["dashboard", "news"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/news/list?limit=3", { signal });
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: NewsItem[] };
    },
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  // Positions only — all MONEY numbers come from the portfolio hero (two
  // cards sampling the same wallet on different clocks contradicted each
  // other). Null (not thrown) when not connected: the account route 4xxes
  // for never-connected users and endless retries would be waste.
  const bitget = useQuery<BitgetAccount | null>({
    queryKey: ["dashboard", "bitget"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/brokers/bitget/account", { signal });
      if (!res.ok) return null;
      return (await res.json()) as BitgetAccount;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Unified money hub. The route answers 200 + brokers:[] when nothing is
  // connected, so !ok is always a REAL error → throw, and react-query keeps
  // the last good data (previously `return null` blanked the hero — and the
  // user's entire balance — on any transient 5xx).
  const portfolio = useQuery<Portfolio>({
    queryKey: ["dashboard", "portfolio"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/brokers/portfolio", { signal });
      if (!res.ok) throw new Error("Không tải được số dư");
      return (await res.json()) as Portfolio;
    },
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  });

  const s = dash.data?.stats;
  const ccy = dash.data?.currency ?? "USD";
  const positions = bitget.data?.positions ?? [];

  // A failed /api/dashboard must never fall through to the empty states —
  // "Chưa đủ lịch sử giao dịch" in front of 300 closed trades reads as data
  // loss. Hard failure (nothing cached) gets an explicit error + retry;
  // a failed refetch on top of good data only gets a "stale" note.
  const dashFailed = dash.isError && dash.data === undefined;
  const dashStale = dash.isError && dash.data !== undefined;

  // "Lệnh đang mở" merges journal OPEN entries with live positions so a
  // real position can never display as zero.
  const openDisplay =
    s !== undefined ? Math.max(s.openCount, positions.length) : null;

  const enoughSample = (s?.closed30 ?? 0) >= MIN_SAMPLE;
  const statCells = [
    {
      label: "P/L hôm nay",
      value:
        s === undefined
          ? null
          : `${s.todayPnl > 0 ? "+" : ""}${fmt(s.todayPnl)}`,
      hint: `${ccy} · lệnh đóng trong ngày (giờ VN)`,
      tone: s === undefined ? 0 : Math.sign(s.todayPnl),
    },
    {
      label: "Lệnh đang mở",
      value: openDisplay === null ? null : String(openDisplay),
      hint:
        positions.length > 0
          ? `${positions.length} vị thế thật trên sàn`
          : "Nhật ký + sàn",
      tone: 0,
    },
    {
      label: "Hiệu suất 30 ngày",
      value:
        s === undefined
          ? null
          : !enoughSample
            ? "—"
            : `WR ${((s.winRate30 ?? 0) * 100).toFixed(0)}% · ${
                (s.avgR30 ?? 0) > 0 ? "+" : ""
              }${(s.avgR30 ?? 0).toFixed(2)}R`,
      hint: !s
        ? ""
        : enoughSample
          ? `${s.closed30} lệnh đóng trong 30 ngày`
          : `Chưa đủ dữ liệu (${s.closed30} lệnh đóng)`,
      tone: s === undefined || !enoughSample ? 0 : Math.sign(s.avgR30 ?? 0),
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── 1. HERO: money first ─────────────────────────────────────── */}
      {portfolio.isPending ? (
        <HeroSkeleton />
      ) : portfolio.data && portfolio.data.brokers.length > 0 ? (
        <PortfolioHero
          data={portfolio.data}
          stale={portfolio.isError}
          onRetry={() => void portfolio.refetch()}
        />
      ) : portfolio.isError ? (
        <Card>
          <CardContent className="py-6">
            <LoadError
              className="min-h-[120px]"
              message="Không tải được tổng tài sản."
              onRetry={() => void portfolio.refetch()}
              retrying={portfolio.isFetching}
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-7 text-center sm:flex-row sm:justify-between sm:text-left">
            <div className="flex items-center gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary max-sm:hidden">
                <Wallet className="size-5" />
              </div>
              <div>
                <p className="font-medium">Chưa kết nối sàn nào</p>
                <p className="text-sm text-muted-foreground">
                  Kết nối Bitget, Binance, MEXC hoặc OKX để xem tổng tài sản —
                  chỉ đọc, không cần quyền rút tiền.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              render={<Link href="/settings" />}
            >
              Kết nối sàn
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── 2. Open positions — only when real risk is on ────────────── */}
      {positions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {positions.map((p) => (
            <div
              key={`${p.symbol}-${p.side}`}
              className="num flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs"
            >
              <span className="font-medium">{p.symbol}</span>
              <span
                className={cn(
                  "rounded-sm px-1.5 py-0.5 text-[10px] font-medium tracking-wide",
                  p.side === "long"
                    ? "bg-bullish/10 text-bullish"
                    : "bg-bearish/10 text-bearish",
                )}
              >
                {p.side.toUpperCase()} {p.leverage ?? "?"}x
              </span>
              <span
                className={cn(
                  (p.unrealizedPnl ?? 0) > 0 && "text-bullish",
                  (p.unrealizedPnl ?? 0) < 0 && "text-bearish",
                )}
              >
                {(p.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                {fmt(p.unrealizedPnl)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── 3. Journal stat strip (one segmented container) ──────────── */}
      {dashStale ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Số liệu nhật ký là bản cũ ·{" "}
          <button
            type="button"
            onClick={() => void dash.refetch()}
            className="underline"
          >
            thử lại
          </button>
        </p>
      ) : null}
      {dashFailed ? (
        <LoadError
          className="rounded-xl border bg-card px-4 py-6"
          message="Không tải được số liệu nhật ký."
          onRetry={() => void dash.refetch()}
          retrying={dash.isFetching}
        />
      ) : (
        <div className="grid grid-cols-1 divide-y divide-border/60 overflow-hidden rounded-xl border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {statCells.map((st) => (
            <div key={st.label} className="px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {st.label}
              </div>
              {st.value === null ? (
                <Skeleton className="mt-1 h-7 w-24" />
              ) : (
                <div
                  className={cn(
                    "num mt-1 text-xl font-semibold",
                    st.tone > 0 && "text-bullish",
                    st.tone < 0 && "text-bearish",
                  )}
                >
                  {st.value}
                </div>
              )}
              <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                {st.hint}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 4. Chart + rail ──────────────────────────────────────────── */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              Đường equity
              <span className="text-xs font-normal text-muted-foreground">
                · P/L tích lũy lệnh đã đóng ({ccy})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : dashFailed ? (
              <LoadError
                className="h-56 rounded-lg border border-dashed bg-card/40"
                message="Không tải được đường equity."
                onRetry={() => void dash.refetch()}
                retrying={dash.isFetching}
              />
            ) : (dash.data?.equitySeries.length ?? 0) < 2 ? (
              <EmptyState
                className="h-56 min-h-0 py-6"
                icon={TrendingUp}
                title="Chưa đủ lịch sử giao dịch"
                description="Cần ít nhất 2 lệnh đã đóng để vẽ đường equity."
              />
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={dash.data!.equitySeries}
                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="var(--color-primary)"
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--color-primary)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="t"
                      tickFormatter={(v: string) => format(parseISO(v), "dd/MM")}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v: number) => fmt(v, 0)}
                    />
                    <Tooltip
                      formatter={(value) => [
                        `${fmt(Number(value))} ${ccy}`,
                        "Equity",
                      ]}
                      labelFormatter={(v) =>
                        format(parseISO(String(v)), "dd/MM/yyyy HH:mm")
                      }
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#eqFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Right rail ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Latest scanner picks — always render once dash settles, with
              a run-your-first-scan CTA for fresh accounts */}
          {dash.isLoading ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Quét gần nhất</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : dashFailed ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Quét gần nhất</CardTitle>
              </CardHeader>
              <CardContent>
                <LoadError
                  message="Không tải được lần quét gần nhất."
                  onRetry={() => void dash.refetch()}
                  retrying={dash.isFetching}
                />
              </CardContent>
            </Card>
          ) : dash.data?.latestRun && dash.data.latestRun.top.length > 0 ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Quét gần nhất</CardTitle>
                <CardAction>
                  <span className="num text-[11px] text-muted-foreground">
                    {format(
                      parseISO(dash.data.latestRun.createdAt),
                      "dd/MM HH:mm",
                    )}
                  </span>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-1">
                {dash.data.latestRun.top.map((r) => (
                  <Link
                    key={r.symbol}
                    href={`/scanner/analysis/crypto/${r.symbol}`}
                    className="group flex items-center justify-between rounded-md border border-transparent px-2 py-1.5 text-sm transition hover:border-border hover:bg-accent/40"
                  >
                    <span className="font-mono">{r.symbol}</span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 text-[10px] font-medium tracking-wide",
                          r.signal === "BULLISH"
                            ? "bg-bullish/10 text-bullish"
                            : "bg-bearish/10 text-bearish",
                        )}
                      >
                        {r.signal}
                      </span>
                      <ChevronRight className="size-3.5 text-muted-foreground transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Quét gần nhất</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-2">
                <p className="text-xs text-muted-foreground">
                  Chưa có lần quét nào.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href="/scanner" />}
                >
                  <Radar className="size-4" />
                  Chạy quét đầu tiên
                </Button>
              </CardContent>
            </Card>
          )}

          {/* News (compact) */}
          {(news.data?.items.length ?? 0) > 0 ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Newspaper className="size-4 text-primary" />
                  Tin nóng
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {news.data!.items.map((n) => (
                  <a
                    key={n.id}
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border border-transparent px-2 py-1.5 transition hover:border-border hover:bg-accent/40"
                  >
                    <div className="line-clamp-2 text-xs font-medium leading-snug">
                      {n.sentiment === "bullish" || n.sentiment === "bearish" ? (
                        <span
                          className={cn(
                            "mr-1.5 inline-block size-1.5 rounded-full align-middle",
                            n.sentiment === "bullish"
                              ? "bg-bullish"
                              : "bg-bearish",
                          )}
                        />
                      ) : null}
                      {n.title}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {n.source} ·{" "}
                      {format(parseISO(n.publishedAt), "dd/MM HH:mm")}
                    </div>
                  </a>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────────────

/**
 * The one "không tải được + Thử lại" block every panel uses. Kept shared so
 * a broken panel always says so in the same words instead of quietly
 * borrowing the empty state of a brand-new account.
 */
function LoadError({
  message,
  onRetry,
  retrying = false,
  className,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">{message}</p>
      {/* The retry stays visibly busy — on the flaky mobile network that
          causes this state, a dead-feeling button gets tapped over and over. */}
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Đang tải…" : "Thử lại"}
      </Button>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <Card>
      <CardContent className="grid min-h-[176px] gap-6 py-5 lg:grid-cols-[minmax(200px,260px)_1fr]">
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-full min-h-24 w-full rounded-lg" />
          <Skeleton className="h-full min-h-24 w-full rounded-lg" />
        </div>
      </CardContent>
    </Card>
  );
}

function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "up" | "down";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "up" && "bg-bullish/10 text-bullish",
        tone === "down" && "bg-bearish/10 text-bearish",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Money hub hero — grand total left, one quiet sub-panel per broker right.
 * Everything read-only; per-section errors render inline so one broken key
 * never blanks the card, and errored numbers are never presented as real
 * zeros ("Tổng cộng 0.00" reads as funds gone).
 */
function PortfolioHero({
  data,
  stale,
  onRetry,
}: {
  data: Portfolio;
  stale: boolean;
  onRetry: () => void;
}) {
  const pnl = data.totals.unrealizedPnl;
  const hasError = data.brokers.some((b) => b.spot.error || b.futures.error);

  return (
    <Card>
      <CardContent className="grid gap-6 py-5 lg:grid-cols-[minmax(200px,260px)_1fr]">
        {/* Left: the number */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tổng tài sản
            {hasError ? (
              <span className="ml-1 normal-case tracking-normal text-amber-600 dark:text-amber-400">
                (thiếu dữ liệu)
              </span>
            ) : null}
          </p>
          <div className="num truncate text-3xl font-semibold tracking-tight">
            {fmt(data.totals.totalUsd)}{" "}
            <span className="text-base font-normal text-muted-foreground">
              USDT
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip>Futures {fmt(data.totals.futuresUsd)}</Chip>
            <Chip>Spot {fmt(data.totals.spotUsd)}</Chip>
            <Chip tone={pnl > 0 ? "up" : pnl < 0 ? "down" : "neutral"}>
              PnL {pnl >= 0 ? "+" : ""}
              {fmt(pnl)}
            </Chip>
          </div>
          {stale ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Dữ liệu cũ ·{" "}
              <button type="button" onClick={onRetry} className="underline">
                thử lại
              </button>
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground/70">
            Cập nhật {format(parseISO(data.fetchedAt), "HH:mm")} · USDT-M ·
            chỉ xem
          </p>
        </div>

        {/* Right: per-broker sub-panels. With a single broker the panel
            takes the full row (a lone half-width panel left the hero's
            right side visibly empty). */}
        <div
          className={cn(
            "grid gap-3",
            data.brokers.length > 1 && "sm:grid-cols-2",
          )}
        >
          {data.brokers.map((b) => (
            <BrokerPanel
              key={b.broker}
              b={b}
              wide={data.brokers.length === 1}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BrokerPanel({
  b,
  wide = false,
}: {
  b: Portfolio["brokers"][number];
  wide?: boolean;
}) {
  const name =
    b.broker === "BITGET"
      ? "Bitget"
      : b.broker === "BINANCE"
        ? "Binance"
        : b.broker === "MEXC"
          ? "MEXC"
          : "OKX";
  const errored = Boolean(b.spot.error || b.futures.error);
  const total = b.spot.totalUsd + b.futures.equity;
  const upnl = b.futures.unrealizedPnl;

  // Everything not in the top-3 inline list collapses into one token.
  const shownAssets = b.spot.assets.slice(0, 3);
  const hiddenCount =
    Math.max(0, b.spot.assets.length - 3) +
    b.spot.otherCount +
    b.spot.dustCount +
    b.spot.unpricedCount;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{name}</span>
        <span className="num text-sm">
          {errored ? "—" : <>≈ {fmt(total)}</>}
        </span>
      </div>

      <div
        className={cn(
          "mt-1.5",
          wide ? "grid gap-x-8 gap-y-1 sm:grid-cols-2" : "space-y-1",
        )}
      >
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Futures</span>
          {b.futures.error ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="num">
              {fmt(b.futures.equity)}
              {upnl !== 0 ? (
                <span
                  className={cn(
                    "ml-1",
                    upnl > 0 ? "text-bullish" : "text-bearish",
                  )}
                >
                  ({upnl > 0 ? "+" : ""}
                  {fmt(upnl)})
                </span>
              ) : null}
            </span>
          )}
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Spot</span>
          {b.spot.error ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="num">{fmt(b.spot.totalUsd)}</span>
          )}
        </div>
      </div>

      {b.futures.error ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {b.futures.error}
        </p>
      ) : null}
      {b.spot.error ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {b.spot.error}
        </p>
      ) : shownAssets.length > 0 ? (
        <p
          className="num mt-1.5 truncate border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground"
          title={b.spot.assets
            .map((a) => `${a.coin} ≈ ${fmt(a.usdValue)}`)
            .join(" · ")}
        >
          {shownAssets.map((a) => `${a.coin} ${fmt(a.usdValue)}`).join(" · ")}
          {hiddenCount > 0 ? (
            <span className="text-muted-foreground/60">
              {" "}
              +{hiddenCount} coin nhỏ
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
