"use client";

import * as React from "react";
import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import { toast } from "sonner";
import {
  BookOpenText,
  ChevronRight,
  Filter,
  Loader2,
  RefreshCcw,
  RefreshCw,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type {
  JournalStats,
  SerializedTrade,
  TradeListResponse,
} from "@/lib/journal/types";

// ──────────────────────────────────────────────────────────────────────
// Filter state
// ──────────────────────────────────────────────────────────────────────
type Filters = {
  market: "ALL" | "FOREX" | "CRYPTO" | "STOCK" | "COMMODITY" | "INDEX" | "OTHER";
  status: "ALL" | "PENDING" | "OPEN" | "CLOSED" | "CANCELED";
  symbol: string;
  from: string;
  to: string;
};

const INITIAL_FILTERS: Filters = {
  market: "ALL",
  status: "ALL",
  symbol: "",
  from: "",
  to: "",
};

const PAGE_SIZE = 50;

// ──────────────────────────────────────────────────────────────────────
// Utility formatters
// ──────────────────────────────────────────────────────────────────────
function fmtNum(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMoney(n: number, ccy: string): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${ccy} ${fmtNum(n)}`;
}

/**
 * What /api/journal/stats actually returns. `scoredTrades` — closed trades
 * carrying a real P&L, i.e. the set `winRate` is computed over — is not in the
 * shared JournalStats type yet, so it is declared here.
 */
type JournalStatsResponse = JournalStats & { scoredTrades: number };

type LiveQuote = {
  tradeId: string;
  symbol: string;
  price: number;
  /** null when the instrument can't be valued in USD — see derivePnl. */
  unrealizedPnl: number | null;
  slProgress: number | null;
  tpProgress: number | null;
  fetchedAt: string;
};

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────
export function JournalClient() {
  const [filters, setFilters] = React.useState<Filters>(INITIAL_FILTERS);
  const [debouncedSymbol, setDebouncedSymbol] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSymbol(filters.symbol.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.symbol]);

  const queryKey = React.useMemo(
    () => [
      "journal",
      "list",
      filters.market,
      filters.status,
      debouncedSymbol,
      filters.from,
      filters.to,
    ],
    [filters.market, filters.status, debouncedSymbol, filters.from, filters.to],
  );

  const list = useQuery<TradeListResponse>({
    queryKey,
    queryFn: async ({ signal }) => {
      const url = new URL("/api/journal", window.location.origin);
      if (filters.market !== "ALL") url.searchParams.set("market", filters.market);
      if (filters.status !== "ALL") url.searchParams.set("status", filters.status);
      if (debouncedSymbol) url.searchParams.set("symbol", debouncedSymbol);
      if (filters.from) url.searchParams.set("from", filters.from);
      if (filters.to) url.searchParams.set("to", filters.to);
      url.searchParams.set("limit", String(PAGE_SIZE));
      const res = await fetch(url, { signal });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? "Không tải được danh sách");
      }
      return (await res.json()) as TradeListResponse;
    },
    placeholderData: keepPreviousData,
  });

  const stats = useQuery<JournalStatsResponse>({
    queryKey: ["journal", "stats"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/journal/stats", { signal });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? "Không tải được thống kê");
      }
      return (await res.json()) as JournalStatsResponse;
    },
  });

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((s) => ({ ...s, [key]: value }));

  // ─── Read-only broker sync: import OPEN positions into the journal ──────
  const queryClient = useQueryClient();
  const syncBroker = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/journal/sync-broker", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Đồng bộ thất bại");
      return j as {
        created: number;
        updated: number;
        byBroker: Array<{ broker: string; open: number; error?: string }>;
      };
    },
    onSuccess: (data) => {
      // New or refreshed open positions → refresh the list + stats.
      if (data.created + data.updated > 0) {
        queryClient.invalidateQueries({ queryKey: ["journal"] });
      }
    },
    onError: (err) => {
      // Silent for the auto-run on mount; the explicit button wraps its own
      // onError to surface the message.
      console.warn("sync-broker error", err);
    },
  });

  // Live quotes for OPEN trades — fills the empty exit-price and P/L slots
  // with the current price and unrealized PnL. Polls every 30s while any
  // OPEN trade is visible.
  const hasOpenTrades = (list.data?.items ?? []).some(
    (t) => t.status === "OPEN",
  );
  const liveQuotes = useQuery<{ quotes: LiveQuote[] }>({
    queryKey: ["journal", "live-quotes"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/journal/live-quotes", { signal });
      if (!res.ok) throw new Error("live quotes failed");
      return (await res.json()) as { quotes: LiveQuote[] };
    },
    enabled: hasOpenTrades,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const quoteByTradeId = React.useMemo(() => {
    const m = new Map<string, LiveQuote>();
    for (const q of liveQuotes.data?.quotes ?? []) m.set(q.tradeId, q);
    return m;
  }, [liveQuotes.data]);

  // Broker sync only exists for CRYPTO exchanges — a user with no broker
  // connected (or a pure forex journal) must not see the button, and the
  // auto-poll must not fire pointless requests every 60s.
  const brokerStatus = useQuery<{ connected: boolean }>({
    queryKey: ["journal", "broker-connected"],
    queryFn: async ({ signal }) => {
      const [bg, bn, mx, ok] = await Promise.all([
        fetch("/api/brokers/bitget/keys", { signal })
          .then((r) => (r.ok ? r.json() : { connected: false }))
          .catch(() => ({ connected: false })),
        fetch("/api/brokers/binance/keys", { signal })
          .then((r) => (r.ok ? r.json() : { connected: false }))
          .catch(() => ({ connected: false })),
        fetch("/api/brokers/mexc/keys", { signal })
          .then((r) => (r.ok ? r.json() : { connected: false }))
          .catch(() => ({ connected: false })),
        fetch("/api/brokers/okx/keys", { signal })
          .then((r) => (r.ok ? r.json() : { connected: false }))
          .catch(() => ({ connected: false })),
      ]);
      return {
        connected:
          (bg as { connected?: boolean }).connected === true ||
          (bn as { connected?: boolean }).connected === true ||
          (mx as { connected?: boolean }).connected === true ||
          (ok as { connected?: boolean }).connected === true,
      };
    },
    staleTime: 5 * 60_000,
  });
  const brokerConnected = brokerStatus.data?.connected === true;

  // Run sync once when we learn a broker IS connected, then poll every 60s
  // while the journal page is open — safe (read-only), and it means a
  // fill/close/cancel that happens while the user sits on this page shows
  // up without a manual refresh. The server rate-limits this to 6/min so
  // the interval can never overrun it.
  const didAutoSync = React.useRef(false);
  // Mirror isPending into a ref so the interval closure reads the CURRENT
  // value, not the stale first-render one.
  const syncPendingRef = React.useRef(false);
  syncPendingRef.current = syncBroker.isPending;
  React.useEffect(() => {
    if (!brokerConnected) return;
    if (!didAutoSync.current) {
      didAutoSync.current = true;
      syncBroker.mutate();
    }
    const interval = setInterval(() => {
      if (syncPendingRef.current || document.hidden) return;
      syncBroker.mutate();
    }, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerConnected]);

  return (
    <div className="space-y-6">
      <StatsBar data={stats.data} loading={stats.isLoading} />

      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="size-4 text-primary" />
            Bộ lọc
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Sync is a crypto-exchange feature: hidden when no broker is
                connected AND when the user is looking at forex. */}
            {brokerConnected && filters.market !== "FOREX" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  syncBroker.mutate(undefined, {
                    onSuccess: (data) => {
                      const n = data.created + data.updated;
                      const firstErr = data.byBroker.find((b) => b.error)?.error;
                      if (n === 0) {
                        toast.message(
                          firstErr
                            ? `Không nhập được: ${firstErr}`
                            : "Không có vị thế đang mở nào trên sàn.",
                        );
                      } else {
                        toast.success(
                          `Đã nhập ${data.created} vị thế mới, cập nhật ${data.updated} từ sàn.`,
                        );
                        if (firstErr) toast.message(firstErr);
                      }
                    },
                    onError: (err) => {
                      toast.error(
                        err instanceof Error ? err.message : "Đồng bộ thất bại",
                      );
                    },
                  });
                }}
                disabled={syncBroker.isPending}
                title="Đọc vị thế đang mở trên sàn đã kết nối và nhập vào Nhật ký. Chỉ đọc, không đặt/huỷ lệnh."
              >
                {syncBroker.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCcw className="size-4" />
                )}
                Đồng bộ sàn
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilters(INITIAL_FILTERS);
                setDebouncedSymbol("");
              }}
            >
              Đặt lại
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Thị trường</label>
              <Select
                value={filters.market}
                onValueChange={(v) => v && updateFilter("market", v as Filters["market"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Match the trade form: only supported markets. */}
                  <SelectItem value="ALL">Tất cả</SelectItem>
                  <SelectItem value="FOREX">Forex</SelectItem>
                  <SelectItem value="CRYPTO">Crypto</SelectItem>
                  <SelectItem value="OTHER">Khác</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Trạng thái</label>
              <Select
                value={filters.status}
                onValueChange={(v) => v && updateFilter("status", v as Filters["status"])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tất cả</SelectItem>
                  <SelectItem value="PENDING">Chờ khớp</SelectItem>
                  <SelectItem value="OPEN">Đang mở</SelectItem>
                  <SelectItem value="CLOSED">Đã đóng</SelectItem>
                  <SelectItem value="CANCELED">Đã hủy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Symbol</label>
              <Input
                placeholder="BTC, EUR…"
                value={filters.symbol}
                onChange={(e) => updateFilter("symbol", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Từ ngày</label>
              <Input
                type="date"
                value={filters.from}
                onChange={(e) => updateFilter("from", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Đến ngày</label>
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => updateFilter("to", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Danh sách lệnh</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            <RefreshCw
              className={cn("size-4", list.isFetching && "animate-spin")}
            />
            Làm mới
          </Button>
        </CardHeader>
        <CardContent>
          <TradeTable
            loading={list.isLoading}
            error={list.error instanceof Error ? list.error.message : null}
            items={list.data?.items ?? []}
            currency={stats.data?.currency ?? "USD"}
            quotes={quoteByTradeId}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stats bar
// ──────────────────────────────────────────────────────────────────────
/**
 * Caption for the win-rate card. It must name the SAME set the percentage was
 * computed over: closed trades carrying a real P&L. Captioning "60%" with
 * "20 lệnh đã đóng" while the 60% came from 10 of them let a reader
 * back-compute 12 winners when the truth was 6.
 */
function winRateSub(data: JournalStatsResponse): string {
  if (data.closedTrades === 0) return "0 lệnh đã đóng";
  if (data.scoredTrades === 0) {
    return `${data.closedTrades} lệnh đã đóng, chưa lệnh nào có P/L`;
  }
  if (data.scoredTrades === data.closedTrades) {
    return `${data.closedTrades} lệnh đã đóng`;
  }
  return `Tính trên ${data.scoredTrades}/${data.closedTrades} lệnh đã đóng có P/L`;
}

function StatsBar({
  data,
  loading,
}: {
  data: JournalStatsResponse | undefined;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard
        label="Win rate"
        // No trade scored yet → "—". A flat 0% reads as "you lose every
        // trade" rather than "no result entered".
        value={
          loading
            ? null
            : data && data.scoredTrades > 0
              ? fmtPct(data.winRate)
              : "—"
        }
        sub={loading ? null : data ? winRateSub(data) : null}
      />
      <StatCard
        label="R-multiple TB"
        value={loading ? null : data ? data.avgR.toFixed(2) : "—"}
        emphasis={
          data && data.avgR > 0
            ? "bullish"
            : data && data.avgR < 0
              ? "bearish"
              : undefined
        }
      />
      <StatCard
        label="P/L tổng"
        value={
          loading
            ? null
            : data
              ? fmtMoney(data.totalPnl, data.currency)
              : "—"
        }
        emphasis={
          data && data.totalPnl > 0
            ? "bullish"
            : data && data.totalPnl < 0
              ? "bearish"
              : undefined
        }
      />
      <StatCard
        label="Số lệnh"
        value={loading ? null : data ? String(data.totalTrades) : "—"}
        sub={
          loading
            ? null
            : data
              ? `${data.openTrades} đang mở`
              : null
        }
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string | null;
  sub?: string | null;
  emphasis?: "bullish" | "bearish";
}) {
  return (
    <Card className="bg-card/50">
      <CardContent className="space-y-1 p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        {value === null ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div
            className={cn(
              "num text-xl font-semibold",
              emphasis === "bullish" && "text-bullish",
              emphasis === "bearish" && "text-bearish",
            )}
          >
            {value}
          </div>
        )}
        {sub ? (
          <div className="text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Table
// ──────────────────────────────────────────────────────────────────────
function TradeTable({
  loading,
  error,
  items,
  currency,
  quotes,
}: {
  loading: boolean;
  error: string | null;
  items: SerializedTrade[];
  currency: string;
  quotes: Map<string, LiveQuote>;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon={BookOpenText}
        title="Lỗi tải dữ liệu"
        description={error}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={BookOpenText}
        title="Chưa có lệnh nào"
        description="Bấm 'Lệnh mới' để ghi lại giao dịch đầu tiên."
        action={
          <Button render={<Link href="/journal/new" />}>Tạo lệnh mới</Button>
        }
      />
    );
  }

  // Below lg the full 9-column table is ~680px inside a ~311px card, which
  // pushed P/L / Trạng thái / R off-screen behind the (invisible) scroller
  // that <Table> already provides. Rather than nest another one, the four
  // columns that carry the money stay and the rest fold into them; tighter
  // cell padding buys the last few px so nothing has to be scrolled to.
  return (
    <Table className="max-lg:[&_td]:px-1.5 max-lg:[&_th]:px-1.5 max-lg:[&_th]:text-xs">
      <TableHeader>
        <TableRow>
          <TableHead className="max-lg:hidden">Thời gian mở</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead className="max-lg:hidden">Hướng</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="text-right max-lg:hidden">Vào / Ra</TableHead>
          <TableHead className="text-right max-lg:hidden">Lot</TableHead>
          <TableHead className="text-right">P/L ({currency})</TableHead>
          <TableHead className="text-right">R</TableHead>
          <TableHead className="max-lg:hidden"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((t) => (
          <TradeRow
            key={t.id}
            trade={t}
            currency={currency}
            quote={quotes.get(t.id) ?? null}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function TradeRow({
  trade,
  currency,
  quote,
}: {
  trade: SerializedTrade;
  currency: string;
  quote: LiveQuote | null;
}) {
  const opened = parseISO(trade.openedAt);
  const isLong = trade.direction === "LONG";
  const pnl = trade.pnl;
  const isOpen = trade.status === "OPEN";
  const live = isOpen ? quote : null;

  return (
    <TableRow>
      <TableCell className="text-sm max-lg:hidden">
        <div>{format(opened, "yyyy-MM-dd HH:mm")}</div>
        <div className="text-xs text-muted-foreground">
          {formatDistanceToNow(opened, { addSuffix: true, locale: vi })}
        </div>
      </TableCell>
      {/* Wraps instead of nowrap below lg: a long broker symbol would
          otherwise widen the table and push P/L back off a phone screen. */}
      <TableCell className="max-lg:whitespace-normal">
        {/* Also the row's only link below lg, where the chevron is hidden. */}
        <Link
          href={`/journal/${trade.id}`}
          className="block font-mono text-sm font-medium hover:underline max-lg:break-all"
        >
          {trade.symbol}
        </Link>
        <div className="text-xs text-muted-foreground">{trade.market}</div>
        {/* Hướng + Thời gian mở lose their columns below lg — fold them back
            in so a phone row still says which way and when. */}
        <div className="mt-0.5 text-[10px] text-muted-foreground lg:hidden">
          <span
            className={cn(
              "font-medium",
              isLong ? "text-bullish" : "text-bearish",
            )}
          >
            {isLong ? "LONG" : "SHORT"}
          </span>{" "}
          · {format(opened, "dd/MM")}
        </div>
      </TableCell>
      <TableCell className="max-lg:hidden">
        <Badge
          variant="outline"
          className={cn(
            "border-transparent",
            isLong
              ? "bg-bullish/10 text-bullish"
              : "bg-bearish/10 text-bearish",
          )}
        >
          {isLong ? "LONG" : "SHORT"}
        </Badge>
      </TableCell>
      <TableCell>
        <StatusBadge status={trade.status} />
      </TableCell>
      <TableCell className="num text-right text-sm max-lg:hidden">
        <div>{fmtNum(trade.entryPrice, 5)}</div>
        {trade.exitPrice !== null ? (
          <div className="text-xs text-muted-foreground">
            {fmtNum(trade.exitPrice, 5)}
          </div>
        ) : live ? (
          <div className="text-xs text-info" title="Giá hiện tại (live)">
            ▸ {fmtNum(live.price, 5)}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">—</div>
        )}
      </TableCell>
      <TableCell className="num text-right text-sm max-lg:hidden">
        {fmtNum(trade.lotSize, trade.market === "FOREX" ? 2 : 4)}
      </TableCell>
      <TableCell
        className={cn(
          "num text-right text-sm font-medium",
          pnl !== null && pnl > 0 && "text-bullish",
          pnl !== null && pnl < 0 && "text-bearish",
        )}
      >
        {pnl !== null ? (
          `${pnl > 0 ? "+" : ""}${fmtNum(pnl)}`
        ) : (
          // Lệnh đang mở/chờ khớp KHÔNG hiện P/L — app không tự ước lượng; bạn
          // tự nhập lãi/lỗ thật từ sàn khi lệnh đã đóng.
          "—"
        )}
        {/* Without the Vào / Ra column an OPEN row would be nothing but "—"
            below lg, so the live price rides along here instead. */}
        {live ? (
          <div className="text-[10px] font-normal text-info lg:hidden">
            ▸ {fmtNum(live.price, 5)}
          </div>
        ) : null}
      </TableCell>
      <TableCell
        className={cn(
          "num text-right text-sm",
          trade.rMultiple !== null && trade.rMultiple > 0 && "text-bullish",
          trade.rMultiple !== null && trade.rMultiple < 0 && "text-bearish",
        )}
      >
        {trade.rMultiple === null ? "—" : `${trade.rMultiple.toFixed(2)}R`}
      </TableCell>
      <TableCell className="text-right max-lg:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          render={<Link href={`/journal/${trade.id}`} aria-label="Xem chi tiết" />}
        >
          <ChevronRight className="size-4" />
        </Button>
        {/* currency only used in header */}
        <span className="sr-only">{currency}</span>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "PENDING") {
    return (
      <Badge variant="outline" className="border-dashed text-muted-foreground">
        Chờ khớp
      </Badge>
    );
  }
  if (status === "OPEN") {
    return (
      <Badge variant="outline" className="border-transparent bg-info/10 text-info">
        Đang mở
      </Badge>
    );
  }
  if (status === "CLOSED") {
    return (
      <Badge variant="outline" className="border-transparent bg-muted">
        Đã đóng
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-transparent bg-warning/10 text-warning">
      Đã hủy
    </Badge>
  );
}
