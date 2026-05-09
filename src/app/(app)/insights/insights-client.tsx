"use client";

import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  Lock,
  Plus,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { InstrumentCombobox } from "@/components/instrument-combobox";
import { cn } from "@/lib/utils";
import {
  CURATED_CRYPTO,
  CURATED_FOREX,
  isCurated as isCuratedSymbol,
  mergeSymbols,
  normalizeSymbol,
  type InsightMarket,
} from "@/lib/insights/curated";

// ──────────────────────────────────────────────────────────────────────
// Types — mirror server responses
// ──────────────────────────────────────────────────────────────────────

type WatchlistItem = {
  id: string;
  symbol: string;
  market: string;
  exchange: string | null;
  notes: string | null;
  createdAt: string;
};

type WatchlistListResponse = { items: WatchlistItem[] };

type InsightItem = {
  symbol: string;
  market: InsightMarket;
  price: number;
  change1d?: number;
  change7d?: number;
  high24h?: number;
  low24h?: number;
  bullishPercent: number;
  direction: "bullish" | "bearish" | "neutral";
  reasoning: string;
  keyDrivers: string[];
  confidence: "low" | "medium" | "high";
  aiModel: string;
  newsCount: number;
};

type InsightRunResponse = {
  items: InsightItem[];
  errors: { symbol: string; message: string }[];
  generatedAt: string;
};

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtPct(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const s = `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  return s;
}

function pctClass(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return "text-muted-foreground";
  if (n > 0) return "text-bullish";
  if (n < 0) return "text-bearish";
  return "text-muted-foreground";
}

function directionLabel(d: InsightItem["direction"]): string {
  if (d === "bullish") return "Tăng";
  if (d === "bearish") return "Giảm";
  return "Trung lập";
}

function confidenceLabel(c: InsightItem["confidence"]): string {
  if (c === "high") return "Cao";
  if (c === "low") return "Thấp";
  return "Trung bình";
}

function progressColor(pct: number): string {
  if (pct >= 60) return "bg-bullish";
  if (pct <= 40) return "bg-bearish";
  return "bg-warning";
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export function InsightsClient() {
  const qc = useQueryClient();
  const [market, setMarket] = React.useState<InsightMarket>("CRYPTO");
  const [showManager, setShowManager] = React.useState(false);
  const [picker, setPicker] = React.useState("");
  const [customSymbol, setCustomSymbol] = React.useState("");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  // Per-market run state — we keep both so switching tabs preserves
  // the most recent analysis without re-running.
  const [runs, setRuns] = React.useState<
    Partial<Record<InsightMarket, InsightRunResponse>>
  >({});

  // ── Watchlist ──────────────────────────────────────────────────────
  const watchlistQ = useQuery({
    queryKey: ["watchlist", market],
    queryFn: async () => {
      const url = new URL("/api/watchlist", window.location.origin);
      url.searchParams.set("market", market);
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Tải watchlist thất bại");
      }
      return data as WatchlistListResponse;
    },
    staleTime: 30_000,
  });

  const userSymbols: string[] = React.useMemo(
    () => (watchlistQ.data?.items ?? []).map((w) => w.symbol),
    [watchlistQ.data],
  );

  const watchlistByNorm = React.useMemo(() => {
    const map = new Map<string, WatchlistItem>();
    for (const w of watchlistQ.data?.items ?? []) {
      map.set(normalizeSymbol(w.symbol), w);
    }
    return map;
  }, [watchlistQ.data]);

  const allSymbols: string[] = React.useMemo(
    () => mergeSymbols(market, userSymbols),
    [market, userSymbols],
  );

  // ── Watchlist mutations ────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: async (raw: string) => {
      const symbol = normalizeSymbol(raw);
      if (!symbol) throw new Error("Symbol không hợp lệ");
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market, symbol }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Thêm symbol thất bại");
      return data as WatchlistItem;
    },
    onSuccess: (item) => {
      toast.success(`Đã thêm ${item.symbol}`);
      qc.invalidateQueries({ queryKey: ["watchlist", market] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Lỗi thêm symbol"),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Xóa symbol thất bại");
      return id;
    },
    onSuccess: () => {
      toast.success("Đã xóa khỏi watchlist");
      qc.invalidateQueries({ queryKey: ["watchlist", market] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Lỗi xóa symbol"),
  });

  // ── Analyze ────────────────────────────────────────────────────────
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (allSymbols.length === 0) {
        throw new Error("Chưa có symbol nào để phân tích");
      }
      const res = await fetch("/api/insights/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market,
          symbols: allSymbols.slice(0, 20),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Phân tích thất bại");
      return data as InsightRunResponse;
    },
    onSuccess: (data) => {
      setRuns((prev) => ({ ...prev, [market]: data }));
      const msg =
        data.errors.length > 0
          ? `Đã phân tích ${data.items.length} symbol (${data.errors.length} lỗi).`
          : `Đã phân tích ${data.items.length} symbol.`;
      if (data.errors.length > 0) {
        toast.warning(msg);
      } else {
        toast.success(msg);
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Lỗi phân tích"),
  });

  const onMarketChange = (m: string | null) => {
    if (!m) return;
    setMarket(m as InsightMarket);
    setExpanded({});
    setPicker("");
    setCustomSymbol("");
  };

  const currentRun = runs[market];

  const onAddCustom = () => {
    const s = normalizeSymbol(customSymbol);
    if (!s) return;
    addMutation.mutate(s, {
      onSuccess: () => setCustomSymbol(""),
    });
  };

  // ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={market} onValueChange={onMarketChange}>
          <TabsList className="grid w-fit grid-cols-2">
            <TabsTrigger value="FOREX">Forex</TabsTrigger>
            <TabsTrigger value="CRYPTO">Crypto</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowManager((v) => !v)}
          >
            <Settings2 className="size-4" />
            Quản lý symbol
            <Badge variant="secondary" className="ml-1 h-5 font-mono text-[11px]">
              {allSymbols.length}
            </Badge>
          </Button>
          <Button
            type="button"
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending || allSymbols.length === 0}
          >
            <Sparkles
              className={cn(
                "size-4",
                analyzeMutation.isPending && "animate-pulse",
              )}
            />
            {analyzeMutation.isPending ? "Đang phân tích…" : "Phân tích"}
          </Button>
        </div>
      </div>

      {/* Symbol manager */}
      {showManager ? (
        <SymbolManager
          market={market}
          allSymbols={allSymbols}
          curatedFor={market}
          watchlistByNorm={watchlistByNorm}
          loading={watchlistQ.isLoading}
          picker={picker}
          setPicker={setPicker}
          customSymbol={customSymbol}
          setCustomSymbol={setCustomSymbol}
          onAddPicker={(v) => {
            addMutation.mutate(v, {
              onSuccess: () => setPicker(""),
            });
          }}
          onAddCustom={onAddCustom}
          onRemove={(id) => removeMutation.mutate(id)}
          adding={addMutation.isPending}
          removing={removeMutation.isPending}
        />
      ) : null}

      {/* Results area */}
      {analyzeMutation.isPending ? (
        <ResultsSkeleton count={Math.min(allSymbols.length, 10)} />
      ) : currentRun ? (
        <ResultsList
          run={currentRun}
          expanded={expanded}
          onToggle={(s) =>
            setExpanded((prev) => ({ ...prev, [s]: !prev[s] }))
          }
        />
      ) : (
        <EmptyState
          icon={Sparkles}
          title="Chưa có kết quả"
          description="Bấm Phân tích để chấm điểm bằng AI cho danh sách hiện tại."
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Symbol manager (collapsible)
// ──────────────────────────────────────────────────────────────────────

function SymbolManager(props: {
  market: InsightMarket;
  allSymbols: string[];
  curatedFor: InsightMarket;
  watchlistByNorm: Map<string, WatchlistItem>;
  loading: boolean;
  picker: string;
  setPicker: (v: string) => void;
  customSymbol: string;
  setCustomSymbol: (v: string) => void;
  onAddPicker: (v: string) => void;
  onAddCustom: () => void;
  onRemove: (id: string) => void;
  adding: boolean;
  removing: boolean;
}) {
  const {
    market,
    allSymbols,
    watchlistByNorm,
    loading,
    picker,
    setPicker,
    customSymbol,
    setCustomSymbol,
    onAddPicker,
    onAddCustom,
    onRemove,
    adding,
  } = props;

  const curatedCount =
    market === "FOREX" ? CURATED_FOREX.length : CURATED_CRYPTO.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quản lý danh sách symbol</CardTitle>
        <CardDescription>
          Top {curatedCount} mặc định luôn hiển thị (có biểu tượng khóa). Bạn
          có thể thêm symbol vào watchlist; chỉ symbol bạn thêm mới có thể xóa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Thêm từ danh sách
            </div>
            <InstrumentCombobox
              market={market}
              value={picker}
              onChange={(v) => {
                setPicker(v);
                onAddPicker(v);
              }}
              placeholder="Chọn symbol để thêm…"
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Hoặc gõ symbol tùy chọn
            </div>
            <div className="flex gap-2">
              <Input
                className="num"
                placeholder={
                  market === "CRYPTO" ? "vd: SUIUSDT" : "vd: USDSGD"
                }
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddCustom();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={onAddCustom}
                disabled={adding || !customSymbol.trim()}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Danh sách hiện tại ({allSymbols.length})
            {loading ? " — đang tải…" : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allSymbols.map((s) => {
              const curated = isCuratedSymbol(market, s);
              const wl = watchlistByNorm.get(s);
              return (
                <Badge
                  key={s}
                  variant={curated ? "secondary" : "outline"}
                  className="h-7 gap-1.5 px-2 font-mono text-[11px]"
                >
                  {curated ? (
                    <Lock className="size-3 text-muted-foreground" />
                  ) : null}
                  {s}
                  {!curated && wl ? (
                    <button
                      type="button"
                      className="-mr-0.5 rounded-sm opacity-70 hover:opacity-100"
                      onClick={() => onRemove(wl.id)}
                      aria-label={`Bỏ ${s}`}
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </Badge>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Results list
// ──────────────────────────────────────────────────────────────────────

function ResultsList(props: {
  run: InsightRunResponse;
  expanded: Record<string, boolean>;
  onToggle: (symbol: string) => void;
}) {
  const { run, expanded, onToggle } = props;

  if (run.items.length === 0 && run.errors.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Không có kết quả"
        description="Hãy thử lại với danh sách khác."
      />
    );
  }

  const generated = new Date(run.generatedAt);
  const hh = generated.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Cập nhật lúc <span className="num">{hh}</span> · {run.items.length}{" "}
          kết quả
        </span>
        {run.errors.length > 0 ? (
          <span className="text-warning">
            {run.errors.length} lỗi (xem cuối trang)
          </span>
        ) : null}
      </div>

      <div className="grid gap-3">
        {run.items.map((item, idx) => (
          <ResultCard
            key={item.symbol}
            rank={idx + 1}
            item={item}
            expanded={!!expanded[item.symbol]}
            onToggle={() => onToggle(item.symbol)}
          />
        ))}
      </div>

      {run.errors.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-warning">
              Lỗi phân tích ({run.errors.length})
            </CardTitle>
            <CardDescription>
              Các symbol dưới đây không thể phân tích. Thường do thiếu dữ liệu
              giá hoặc lỗi gọi Gemini. Có thể thử lại sau.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {run.errors.map((e) => (
                <li key={e.symbol} className="flex gap-2">
                  <span className="font-mono text-xs">{e.symbol}</span>
                  <span className="text-muted-foreground">— {e.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ResultCard(props: {
  rank: number;
  item: InsightItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { rank, item, expanded, onToggle } = props;

  return (
    <Card>
      <CardContent className="px-4">
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-4">
          {/* Rank + symbol */}
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
              #{rank}
            </div>
            <div className="space-y-0.5">
              <div className="font-mono text-sm font-semibold">
                {item.symbol}
              </div>
              <div className="num text-xs text-muted-foreground">
                {fmtPrice(item.price)}
              </div>
            </div>
          </div>

          {/* Middle: percent bar + reasoning */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full transition-all",
                      progressColor(item.bullishPercent),
                    )}
                    style={{ width: `${item.bullishPercent}%` }}
                  />
                </div>
              </div>
              <div className="num min-w-[3.5ch] text-right text-sm font-semibold">
                {item.bullishPercent}%
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {item.reasoning}
            </p>
          </div>

          {/* Right side: changes + badges */}
          <div className="flex flex-col items-end gap-2 lg:min-w-[180px]">
            <div className="flex gap-3 text-xs">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  1d
                </div>
                <div className={cn("num font-semibold", pctClass(item.change1d))}>
                  {fmtPct(item.change1d)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  7d
                </div>
                <div className={cn("num font-semibold", pctClass(item.change7d))}>
                  {fmtPct(item.change7d)}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <DirectionBadge direction={item.direction} />
              <ConfidenceBadge confidence={item.confidence} />
              {item.newsCount > 0 ? (
                <Badge variant="ghost" className="h-5 gap-1 px-1.5 text-[10px]">
                  {item.newsCount} tin
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        {/* Drivers + expand */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
          {item.keyDrivers.slice(0, expanded ? undefined : 3).map((d, i) => (
            <Badge
              key={i}
              variant="outline"
              className="h-6 px-2 text-[11px] font-normal"
            >
              {d}
            </Badge>
          ))}
          {item.keyDrivers.length > 3 || expanded ? (
            <button
              type="button"
              onClick={onToggle}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? "Thu gọn" : `+${Math.max(item.keyDrivers.length - 3, 0)} thêm`}
              <ChevronDown
                className={cn(
                  "size-3 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            </button>
          ) : null}
          {expanded ? (
            <div className="mt-1 w-full text-[11px] text-muted-foreground">
              Model: <span className="font-mono">{item.aiModel}</span>
              {item.high24h !== undefined && item.low24h !== undefined ? (
                <>
                  {" · "}
                  H/L 24h:{" "}
                  <span className="num">{fmtPrice(item.high24h)}</span> /{" "}
                  <span className="num">{fmtPrice(item.low24h)}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DirectionBadge({
  direction,
}: {
  direction: InsightItem["direction"];
}) {
  if (direction === "bullish") {
    return (
      <Badge className="h-5 bg-bullish/15 text-bullish [a]:hover:bg-bullish/25">
        {directionLabel(direction)}
      </Badge>
    );
  }
  if (direction === "bearish") {
    return (
      <Badge className="h-5 bg-bearish/15 text-bearish [a]:hover:bg-bearish/25">
        {directionLabel(direction)}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="h-5">
      {directionLabel(direction)}
    </Badge>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: InsightItem["confidence"];
}) {
  const styles =
    confidence === "high"
      ? "bg-info/15 text-info"
      : confidence === "low"
        ? "bg-muted text-muted-foreground"
        : "bg-warning/15 text-warning";
  return (
    <Badge className={cn("h-5", styles)}>{confidenceLabel(confidence)}</Badge>
  );
}

function ResultsSkeleton({ count }: { count: number }) {
  const n = Math.max(3, Math.min(count, 10));
  return (
    <div className="grid gap-3">
      {Array.from({ length: n }).map((_, i) => (
        <Card key={i}>
          <CardContent className="px-4">
            <div className="flex items-center gap-4">
              <Skeleton className="size-9 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-2 w-full" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
