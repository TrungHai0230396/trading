"use client";

/**
 * Tổng quan — the live dashboard.
 *
 * Two independent data sources, polled on different clocks:
 *   - /api/dashboard (local DB aggregate)         → 60s
 *   - /api/brokers/bitget/account (exchange call) → 60s, fails silently
 *     when Bitget isn't connected so the rest of the page stays useful.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Activity,
  BookOpenText,
  Calculator,
  ChevronRight,
  Newspaper,
  Radar,
  TrendingUp,
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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types (mirror /api/dashboard + /api/brokers/bitget/account)
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

const fmt = (n: number | null | undefined, dp = 2): string =>
  typeof n === "number" && Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      }).format(n)
    : "—";

const QUICK_LINKS = [
  { href: "/calculator", icon: Calculator, label: "Tính khối lượng", desc: "Tính lot theo risk" },
  { href: "/journal/new", icon: BookOpenText, label: "Lệnh mới", desc: "Ghi vào nhật ký" },
  { href: "/scanner", icon: Radar, label: "Quét đa khung", desc: "Tín hiệu + watchlist" },
];

type NewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: string | null;
};

type SpotPortfolio = {
  brokers: Array<{
    broker: "BITGET" | "BINANCE";
    totalUsd: number;
    assets: Array<{ coin: string; total: number; usdValue: number }>;
    otherCount: number;
    otherUsd: number;
    dustCount: number;
    unpricedCount: number;
    error?: string;
  }>;
  fetchedAt: string;
};

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

  // Compact news feed — the standalone news page was removed; a cron keeps
  // the table fresh and this card is its visible surface.
  const news = useQuery<{ items: NewsItem[] }>({
    queryKey: ["dashboard", "news"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/news/list?limit=5", { signal });
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: NewsItem[] };
    },
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  const bitget = useQuery<BitgetAccount | null>({
    queryKey: ["dashboard", "bitget"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/brokers/bitget/account", { signal });
      if (!res.ok) return null; // not connected / exchange down — no card
      return (await res.json()) as BitgetAccount;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Read-only spot holdings across connected brokers. Server caches 60s;
  // no card when no broker is connected (empty brokers array).
  const spot = useQuery<SpotPortfolio | null>({
    queryKey: ["dashboard", "spot"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/brokers/spot-balances", { signal });
      if (!res.ok) return null;
      return (await res.json()) as SpotPortfolio;
    },
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  });

  const s = dash.data?.stats;
  const ccy = dash.data?.currency ?? "USD";
  const positions = bitget.data?.positions ?? [];

  // "Lệnh đang mở" merges journal OPEN entries with live Bitget positions
  // so a real position can never display as zero.
  const openDisplay =
    s !== undefined
      ? Math.max(s.openCount, positions.length)
      : null;

  const stats = [
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
          ? `${positions.length} vị thế thật trên Bitget`
          : "Nhật ký + Bitget",
      tone: 0,
    },
    {
      label: "Win rate (30 ngày)",
      value:
        s === undefined
          ? null
          : s.winRate30 === null
            ? "—"
            : `${(s.winRate30 * 100).toFixed(1)}%`,
      hint: s ? `${s.closed30} lệnh đóng trong 30 ngày` : "",
      tone: 0,
    },
    {
      label: "R-multiple TB",
      value:
        s === undefined
          ? null
          : s.avgR30 === null
            ? "—"
            : `${s.avgR30 > 0 ? "+" : ""}${s.avgR30.toFixed(2)}R`,
      hint: "30 ngày gần nhất",
      tone: s?.avgR30 == null ? 0 : Math.sign(s.avgR30),
    },
  ];

  return (
    <>
      {/* ── Stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((st) => (
          <Card key={st.label} className="border-border/60">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-medium uppercase tracking-wider">
                {st.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {st.value === null ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div
                  className={cn(
                    "num text-2xl font-semibold",
                    st.tone > 0 && "text-bullish",
                    st.tone < 0 && "text-bearish",
                  )}
                >
                  {st.value}
                </div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">{st.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* ── Equity curve ─────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              Đường equity
            </CardTitle>
            <CardDescription>
              P/L tích lũy của các lệnh đã đóng ({ccy}).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dash.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (dash.data?.equitySeries.length ?? 0) < 2 ? (
              <EmptyState
                icon={TrendingUp}
                title="Chưa đủ lịch sử giao dịch"
                description="Cần ít nhất 2 lệnh đã đóng để vẽ đường equity."
              />
            ) : (
              <div className="h-64">
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

        {/* ── Right column ─────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Bitget snapshot — only when connected */}
          {bitget.data ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bitget Futures</CardTitle>
                <CardDescription>Số dư & vị thế trực tiếp.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Khả dụng</span>
                  <span className="font-mono">
                    {fmt(bitget.data.balance.available)}{" "}
                    {bitget.data.balance.marginCoin}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PnL chưa chốt</span>
                  <span
                    className={cn(
                      "font-mono",
                      (bitget.data.balance.unrealizedPnl ?? 0) > 0 &&
                        "text-bullish",
                      (bitget.data.balance.unrealizedPnl ?? 0) < 0 &&
                        "text-bearish",
                    )}
                  >
                    {(bitget.data.balance.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                    {fmt(bitget.data.balance.unrealizedPnl)}
                  </span>
                </div>
                {positions.length > 0 ? (
                  <div className="mt-2 space-y-1 border-t pt-2">
                    {positions.map((p) => (
                      <div
                        key={`${p.symbol}-${p.side}`}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="font-mono">
                          {p.symbol}{" "}
                          <Badge
                            variant={p.side === "long" ? "default" : "destructive"}
                            className="ml-1 text-[10px]"
                          >
                            {p.side.toUpperCase()} {p.leverage ?? "?"}x
                          </Badge>
                        </span>
                        <span
                          className={cn(
                            "font-mono",
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
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Không có vị thế đang mở.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Spot holdings (read-only) — only when a broker is connected */}
          {spot.data && spot.data.brokers.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tài sản Spot</CardTitle>
                <CardDescription>
                  Số dư ví spot (chỉ xem) · làm mới mỗi 2 phút.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {spot.data.brokers.map((b) => (
                  <div key={b.broker} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {b.broker === "BITGET" ? "Bitget" : "Binance"}
                      </span>
                      {b.error ? null : (
                        <span className="font-mono">
                          ≈ {fmt(b.totalUsd)} USDT
                        </span>
                      )}
                    </div>
                    {b.error ? (
                      <p className="text-xs text-muted-foreground">
                        {b.error}
                      </p>
                    ) : b.assets.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {b.dustCount + b.unpricedCount > 0
                          ? `Không có coin ≥ $1 (${b.dustCount} bụi, ${b.unpricedCount} không định giá được).`
                          : "Ví spot trống."}
                      </p>
                    ) : (
                      <div className="space-y-0.5">
                        {b.assets.map((a) => (
                          <div
                            key={a.coin}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="font-mono">{a.coin}</span>
                            <span className="font-mono text-muted-foreground">
                              {a.total.toLocaleString("en-US", {
                                maximumFractionDigits: 6,
                              })}{" "}
                              · ≈ {fmt(a.usdValue)}
                            </span>
                          </div>
                        ))}
                        {b.otherCount > 0 ? (
                          <p className="pt-0.5 text-[11px] text-muted-foreground">
                            + {b.otherCount} coin khác ≈ {fmt(b.otherUsd)}
                          </p>
                        ) : null}
                        {b.dustCount > 0 ? (
                          <p className="pt-0.5 text-[11px] text-muted-foreground">
                            + {b.dustCount} coin bụi &lt; $1 (đã ẩn)
                          </p>
                        ) : null}
                        {b.unpricedCount > 0 ? (
                          <p className="pt-0.5 text-[11px] text-muted-foreground">
                            + {b.unpricedCount} coin không định giá được (thiếu
                            cặp USDT)
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* Latest scanner picks */}
          {dash.data?.latestRun && dash.data.latestRun.top.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quét gần nhất</CardTitle>
                <CardDescription>
                  Top đồng thuận ·{" "}
                  {format(parseISO(dash.data.latestRun.createdAt), "dd/MM HH:mm")}
                </CardDescription>
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
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-transparent text-[10px]",
                          r.signal === "BULLISH"
                            ? "bg-bullish/10 text-bullish"
                            : "bg-bearish/10 text-bearish",
                        )}
                      >
                        {r.signal}
                      </Badge>
                      <ChevronRight className="size-3.5 text-muted-foreground transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* News feed (compact) */}
          {(news.data?.items.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Newspaper className="size-4 text-primary" />
                  Tin nóng
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {news.data!.items.map((n) => (
                  <a
                    key={n.id}
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border border-transparent px-2 py-1.5 transition hover:border-border hover:bg-accent/40"
                  >
                    <div className="line-clamp-2 text-xs font-medium leading-snug">
                      {n.sentiment === "bullish"
                        ? "🟢 "
                        : n.sentiment === "bearish"
                          ? "🔴 "
                          : ""}
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

          {/* Quick links */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Truy cập nhanh</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {QUICK_LINKS.map(({ href, icon: Icon, label, desc }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-center gap-3 rounded-md border border-transparent px-3 py-2 transition hover:border-border hover:bg-accent/40"
                >
                  <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
