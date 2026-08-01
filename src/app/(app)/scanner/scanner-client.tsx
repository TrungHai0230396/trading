"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  BellRing,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  LineChart as LineChartIcon,
  Radar,
  Plus,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InstrumentCombobox } from "@/components/instrument-combobox";
import {
  ALL_TIMEFRAMES,
  TIMEFRAME_LABELS,
  type Timeframe,
} from "@/lib/scanner/candles";
import { DEFAULT_STRATEGY } from "@/lib/scanner/strategies";
import { ema } from "@/lib/indicators/ema";
import { rsi } from "@/lib/indicators/rsi";
import { wma } from "@/lib/indicators/wma";
import type {
  ConsensusTopEntry,
  PerTimeframeResult,
  ScanResult,
  ScanSummaryEntry,
} from "@/lib/scanner/runner";
import { SignalPill, ScoreBar, type SignalLike } from "./signal-pill";
import {
  tradingViewSymbol,
  tradingViewInterval,
  tradingViewUrl,
} from "@/lib/scanner/tradingview";
import { cn } from "@/lib/utils";

type Market = "FOREX" | "CRYPTO";

const DEFAULT_CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TIMEFRAMES_STORAGE_KEY = "scanner:selected-timeframes";
const CHART_HEIGHT_STORAGE_KEY = "scanner:chart-height";
const RSI_HEIGHT_STORAGE_KEY = "scanner:rsi-height";

// Session-scoped scan cache: survives back-navigation from the analysis
// page but NOT page refresh / new tab (intentional — refresh = fresh data).
// TTL keeps it harmless if the user comes back hours later.
const SESSION_SCAN_KEY = "scanner:session-scan";
const SESSION_SCAN_TTL_MS = 15 * 60_000; // 15 min

// Legacy key we used to persist the entire scan result (including top 10
// đồng thuận). Removed because users couldn't tell the result was stale —
// 5-hour-old top 10 looked identical to a fresh scan. We now clean it
// up on mount so leftover snapshots don't get re-read by older code.
const LEGACY_RESULT_STORAGE_KEY = "scanner:last-result";
const DEFAULT_CHART_HEIGHT = 1000;
const MIN_CHART_HEIGHT = 360;
const MAX_CHART_HEIGHT = 1800;
const DEFAULT_RSI_HEIGHT = 240;
const MIN_RSI_HEIGHT = 160;
const MAX_RSI_HEIGHT = 520;
const DEFAULT_CHART_TIMEFRAME: Timeframe = "1h";

type FormState = {
  market: Market;
  symbols: string[];
  timeframes: Timeframe[];
  limitPerTF: string;
};

type ChartSelection = {
  symbol: string;
  market: Market;
  timeframe: Timeframe;
};

const initialState = (): FormState => ({
  market: "CRYPTO",
  symbols: [...DEFAULT_CRYPTO],
  timeframes: [...ALL_TIMEFRAMES],
  limitPerTF: "200",
});

function parseStoredTimeframes(value: string | null): Timeframe[] | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    const timeframes = parsed.filter((item): item is Timeframe =>
      (ALL_TIMEFRAMES as readonly string[]).includes(item),
    );

    return timeframes.length > 0 ? Array.from(new Set(timeframes)) : null;
  } catch {
    return null;
  }
}

function normalizeChartSelection(selection: ChartSelection): ChartSelection {
  // "3d" was removed (TradingView's public chart can't render a 3-day link).
  // Coerce any legacy value still persisted in localStorage to the default.
  return (selection.timeframe as string) === "3d"
    ? { ...selection, timeframe: DEFAULT_CHART_TIMEFRAME }
    : selection;
}

export function ScannerClient() {
  const [state, setState] = React.useState<FormState>(initialState);
  const [pickerSymbol, setPickerSymbol] = React.useState("");
  const [customSymbol, setCustomSymbol] = React.useState("");
  const [result, setResult] = React.useState<ScanResult | null>(null);
  const [resultSavedAt, setResultSavedAt] = React.useState<number | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{
    phase: "USER_SYMBOLS" | "CONSENSUS";
    done: number;
    total: number;
  } | null>(null);
  const [chartSelection, setChartSelection] =
    React.useState<ChartSelection | null>(null);
  const [chartVisible, setChartVisible] = React.useState(true);
  const [chartHeight, setChartHeight] = React.useState(DEFAULT_CHART_HEIGHT);
  const [rsiHeight, setRsiHeight] = React.useState(DEFAULT_RSI_HEIGHT);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      // Restore UI preferences only — NOT the scan result. Scan results
      // go stale fast (live bar moves; top 10 đồng thuận can flip within
      // an hour) and we have no good way to surface "this is N hours
      // old" without misleading the user. So every page load starts
      // with an empty results panel; user re-scans to see fresh data.
      const stored = parseStoredTimeframes(
        window.localStorage.getItem(TIMEFRAMES_STORAGE_KEY),
      );

      const storedChartHeight = Number(
        window.localStorage.getItem(CHART_HEIGHT_STORAGE_KEY),
      );
      if (
        Number.isFinite(storedChartHeight) &&
        storedChartHeight >= MIN_CHART_HEIGHT &&
        storedChartHeight <= MAX_CHART_HEIGHT
      ) {
        setChartHeight(storedChartHeight);
      }

      const storedRsiHeight = Number(
        window.localStorage.getItem(RSI_HEIGHT_STORAGE_KEY),
      );
      if (
        Number.isFinite(storedRsiHeight) &&
        storedRsiHeight >= MIN_RSI_HEIGHT &&
        storedRsiHeight <= MAX_RSI_HEIGHT
      ) {
        setRsiHeight(storedRsiHeight);
      }

      if (stored) {
        setState((prev) =>
          prev.timeframes.join("|") === stored.join("|")
            ? prev
            : { ...prev, timeframes: stored },
        );
      }

      // One-time cleanup of the legacy result snapshot key.
      window.localStorage.removeItem(LEGACY_RESULT_STORAGE_KEY);

      // Restore last scan from sessionStorage if still fresh — purpose
      // is to survive back-navigation from /scanner/analysis/... without
      // losing the user's work. Falls out automatically on tab close.
      try {
        const raw = window.sessionStorage.getItem(SESSION_SCAN_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            result: ScanResult;
            state: FormState;
            savedAt: number;
          } | null;
          const age = parsed ? Date.now() - parsed.savedAt : Infinity;
          if (parsed && age < SESSION_SCAN_TTL_MS) {
            setResult(parsed.result);
            setResultSavedAt(parsed.savedAt);
            if (parsed.state) setState(parsed.state);
          } else {
            window.sessionStorage.removeItem(SESSION_SCAN_KEY);
          }
        }
      } catch {
        window.sessionStorage.removeItem(SESSION_SCAN_KEY);
      }

      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;

    window.localStorage.setItem(
      TIMEFRAMES_STORAGE_KEY,
      JSON.stringify(state.timeframes),
    );
  }, [hydrated, state.timeframes]);

  React.useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(RSI_HEIGHT_STORAGE_KEY, String(rsiHeight));
  }, [hydrated, rsiHeight]);

  const selectChart = React.useCallback((selection: ChartSelection) => {
    setChartSelection(normalizeChartSelection(selection));
  }, []);

  const addSymbol = (raw: string) => {
    const s = raw.trim().toUpperCase().replace("/", "");
    if (!s) return;
    setState((prev) =>
      prev.symbols.includes(s)
        ? prev
        : { ...prev, symbols: [...prev.symbols, s] },
    );
  };

  const removeSymbol = (s: string) =>
    setState((prev) => ({
      ...prev,
      symbols: prev.symbols.filter((x) => x !== s),
    }));

  const toggleTimeframe = (tf: Timeframe) =>
    setState((prev) => ({
      ...prev,
      timeframes: prev.timeframes.includes(tf)
        ? prev.timeframes.filter((x) => x !== tf)
        : [...prev.timeframes, tf],
    }));

  const runScan = useMutation({
    mutationFn: async ({
      includeConsensusTop,
    }: {
      includeConsensusTop: boolean;
    }) => {
      const limitPerTF = Number(state.limitPerTF) || 200;
      const res = await fetch("/api/scanner/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: state.market,
          symbols: includeConsensusTop ? [] : state.symbols,
          timeframes: state.timeframes,
          indicators: [DEFAULT_STRATEGY],
          limitPerTF,
          includeConsensusTop,
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }

      // The server streams NDJSON: one `progress` line per chunk, then a
      // single terminal `result` or `error` line. We read incrementally
      // and update progress state as events come in.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final: ScanResult | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        // Process every complete line we have so far.
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (!event || typeof event !== "object" || !("type" in event)) {
            continue;
          }
          const e = event as Record<string, unknown>;
          if (e.type === "progress") {
            const phase = e.phase === "CONSENSUS" ? "CONSENSUS" : "USER_SYMBOLS";
            const done = typeof e.done === "number" ? e.done : 0;
            const total = typeof e.total === "number" ? e.total : 0;
            setProgress({ phase, done, total });
          } else if (e.type === "result") {
            final = e.data as ScanResult;
          } else if (e.type === "error") {
            throw new Error(
              typeof e.error === "string" ? e.error : "Quét thất bại",
            );
          }
        }
        if (done) break;
      }

      if (!final) throw new Error("Stream kết thúc nhưng chưa có kết quả.");
      return final;
    },
    onMutate: ({ includeConsensusTop }) => {
      // Stale-cache fix: a previous scan (or a snapshot restored from
      // localStorage on mount) may have left consensusTop / summary on
      // screen. Wipe those parts of the result *before* the new request
      // returns so the user doesn't think the old coins are the fresh
      // result while we're still fetching.
      //
      // - "Quét đa khung" (!includeConsensusTop): summary will be replaced
      //   by the new scan; consensusTop won't be touched by the API.
      //   Clear both so we render the loading state cleanly.
      // - "Quét Top 10" (includeConsensusTop): summary will come back
      //   empty (no symbols sent); consensusTop will be overwritten.
      //   Clear consensusTop now to hide the stale list.
      setResult((prev) => {
        if (!prev) return prev;
        if (includeConsensusTop) {
          return { ...prev, consensusTop: undefined };
        }
        return { ...prev, summary: [], consensusTop: undefined };
      });
      setErrorMessage(null);
      setProgress(null);
    },
    onSuccess: (data) => {
      setResult(data);
      setErrorMessage(null);
      setProgress(null);
      // Stash to sessionStorage so back-navigation from the analysis
      // page restores instead of starting empty. Refresh / new tab still
      // clears (sessionStorage is per-tab).
      const savedAt = Date.now();
      setResultSavedAt(savedAt);
      try {
        window.sessionStorage.setItem(
          SESSION_SCAN_KEY,
          JSON.stringify({ result: data, state, savedAt }),
        );
      } catch {
        // sessionStorage may be full or disabled — silently skip.
      }
      setChartSelection((prev) => {
        if (prev && data.summary.some((row) => row.symbol === prev.symbol)) {
          return prev;
        }
        if (!data.summary[0]) return null;
        return {
          symbol: data.summary[0].symbol,
          market: state.market,
          timeframe: ALL_TIMEFRAMES.includes(state.timeframes[0] ?? "1h")
            ? (state.timeframes[0] ?? "1h")
            : DEFAULT_CHART_TIMEFRAME,
        };
      });
      toast.success(
        data.consensusTop
          ? `Đã quét ${data.summary.length} symbol và Top 10 đồng thuận.`
          : `Đã quét ${data.summary.length} symbol.`,
      );
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Lỗi không xác định";
      setErrorMessage(message);
      setProgress(null);
      toast.error(message);
    },
  });

  const canRunCustom =
    state.symbols.length > 0 &&
    state.timeframes.length > 0 &&
    !runScan.isPending;

  const canRunTop10 = state.timeframes.length > 0 && !runScan.isPending;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="size-4 text-primary" />
            Cấu hình quét
          </CardTitle>
          <CardDescription>
            Chọn coin và khung thời gian rồi bấm{" "}
            <strong>Quét coin đã chọn</strong>. Top 10 Bullish/Bearish đồng
            thuận là chức năng riêng, chỉ chạy khi bạn bấm nút quét Top 10.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Thêm symbol</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <InstrumentCombobox
                  market={state.market}
                  value={pickerSymbol}
                  onChange={(v) => {
                    addSymbol(v);
                    setPickerSymbol("");
                  }}
                  placeholder="Chọn để thêm…"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Input
                className="num"
                placeholder="Hoặc gõ symbol tùy chọn (vd: SUIUSDT)"
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (customSymbol.trim()) {
                      addSymbol(customSymbol);
                      setCustomSymbol("");
                    }
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (customSymbol.trim()) {
                    addSymbol(customSymbol);
                    setCustomSymbol("");
                  }
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>

            {state.symbols.length === 0 ? (
              <p className="pt-1 text-xs text-muted-foreground">
                Chưa có symbol nào.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {state.symbols.map((s) => (
                  <Badge
                    key={s}
                    variant="secondary"
                    className="h-6 gap-1 px-2 font-mono text-[11px]"
                  >
                    {s}
                    <button
                      type="button"
                      className="-mr-0.5 rounded-sm opacity-70 hover:opacity-100"
                      onClick={() => removeSymbol(s)}
                      aria-label={`Bỏ ${s}`}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Khung thời gian</Label>
            {!hydrated ? (
              <div className="flex flex-col gap-2">
                {ALL_TIMEFRAMES.map((tf) => (
                  <div
                    key={tf}
                    className="flex items-center gap-2 rounded-md border bg-card/40 px-2.5 py-1.5 text-sm opacity-70"
                  >
                    <div className="size-4 rounded-[4px] border" />
                    <span className="font-mono text-xs">{tf}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {TIMEFRAME_LABELS[tf]}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {ALL_TIMEFRAMES.map((tf) => (
                  <label
                    key={tf}
                    className="flex cursor-pointer items-center gap-2 rounded-md border bg-card/40 px-2.5 py-1.5 text-sm"
                  >
                    <Checkbox
                      checked={state.timeframes.includes(tf)}
                      onCheckedChange={() => toggleTimeframe(tf)}
                    />
                    <span className="font-mono text-xs">{tf}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {TIMEFRAME_LABELS[tf]}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Chỉ báo</Label>
            <div className="rounded-md border bg-card/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              <div className="font-medium text-foreground">
                EMA(9) cắt WMA(45) trên RSI(14)
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block size-2 rounded-full bg-bullish" />
                  EMA (xanh lá)
                </span>
                <span className="text-muted-foreground/60">cắt lên trên</span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block size-2 rounded-full bg-info" />
                  WMA (xanh dương)
                </span>
                <span>= Bullish</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              className="w-full"
              disabled={!canRunCustom}
              onClick={() => runScan.mutate({ includeConsensusTop: false })}
            >
              {runScan.isPending ? "Đang quét đa khung…" : "Quét coin đã chọn"}
            </Button>
            <Button
              type="button"
              className="w-full"
              variant="secondary"
              disabled={!canRunTop10}
              onClick={() => runScan.mutate({ includeConsensusTop: true })}
            >
              {runScan.isPending
                ? "Đang quét Top 10…"
                : "Quét Top 10 đồng thuận"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Nút Top 10 chỉ chạy khi bạn chủ động bấm. Mặc định hệ thống chỉ
              quét danh sách coin đã chọn.
            </p>
            {errorMessage ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <div className="font-medium">Lỗi quét: {errorMessage}</div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <WatchlistPanel />
      </div>

      <div className="space-y-3">
        <StaleResultBanner
          savedAt={resultSavedAt}
          loading={runScan.isPending}
          hasResult={!!result}
        />
        <ResultsPanel
          result={result}
          market={state.market}
          timeframes={state.timeframes}
          loading={runScan.isPending}
          progress={progress}
          chartSelection={chartSelection}
          chartVisible={chartVisible}
          chartHeight={chartHeight}
          rsiHeight={rsiHeight}
          limitPerTF={Number(state.limitPerTF) || 200}
          onRsiHeightChange={setRsiHeight}
          onToggleChart={() => setChartVisible((visible) => !visible)}
          onChartHeightChange={setChartHeight}
          onSelectChart={selectChart}
        />
      </div>
    </div>
  );
}

function ResultsPanel({
  result,
  market,
  timeframes,
  loading,
  progress,
  chartSelection,
  chartVisible,
  chartHeight,
  rsiHeight,
  limitPerTF,
  onRsiHeightChange,
  onToggleChart,
  onChartHeightChange,
  onSelectChart,
}: {
  result: ScanResult | null;
  market: Market;
  timeframes: Timeframe[];
  loading: boolean;
  progress: {
    phase: "USER_SYMBOLS" | "CONSENSUS";
    done: number;
    total: number;
  } | null;
  chartSelection: ChartSelection | null;
  chartVisible: boolean;
  chartHeight: number;
  rsiHeight: number;
  limitPerTF: number;
  onRsiHeightChange: (height: number) => void;
  onToggleChart: () => void;
  onChartHeightChange: (height: number) => void;
  onSelectChart: (selection: ChartSelection) => void;
}) {
  // Show the loading card whenever a scan is in flight. We used to only
  // do this when there was no prior result, but that left stale rows
  // (and especially stale consensusTop) on screen during a fresh scan —
  // looked like the data was cached. We clear those parts in onMutate;
  // showing the loading card here makes the "wait" state explicit.
  if (loading) {
    const pct = progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;
    const phaseLabel = progress
      ? progress.phase === "CONSENSUS"
        ? "Top 10 đồng thuận"
        : "Coin đã chọn"
      : null;
    return (
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-base">Kết quả</CardTitle>
          <CardDescription>
            {progress
              ? `Đang quét ${phaseLabel}… ${progress.done}/${progress.total}`
              : "Đang chuẩn bị quét…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {progress ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{phaseLabel}</span>
                <span className="num tabular-nums font-medium text-foreground">
                  {pct}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${pct ?? 0}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="grid h-60 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
            Đang tải nến và chấm điểm…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-base">Kết quả</CardTitle>
          <CardDescription>
            Cấu hình bên trái rồi bấm <strong>Quét</strong> để xem điểm đồng
            thuận theo từng symbol.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid h-72 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
            Chưa có kết quả
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Kết quả quét</CardTitle>
            <CardDescription>
              {result.summary.length} symbol đã chọn · sắp xếp theo điểm giảm
              dần
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-[11px]">
            run #{result.runId.slice(0, 8)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {result.consensusTop ? (
          <ConsensusTopPanel
            result={result}
            market={market}
            timeframe={timeframes[0] ?? "1h"}
            onSelectChart={onSelectChart}
          />
        ) : null}

        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Điểm</TableHead>
                  <TableHead>Đồng thuận</TableHead>
                  {timeframes.map((tf) => (
                    <TableHead key={tf} className="text-center font-mono">
                      {tf}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.summary.map((row) => (
                  <SummaryRow
                    key={row.symbol}
                    row={row}
                    market={market}
                    timeframes={timeframes}
                    selectedSymbol={chartSelection?.symbol ?? null}
                    onSelectChart={onSelectChart}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <TradingViewPanel
            key={
              chartSelection
                ? `${chartSelection.market}-${chartSelection.symbol}-${chartSelection.timeframe}-${chartVisible ? "visible" : "hidden"}`
                : `empty-${chartVisible ? "visible" : "hidden"}`
            }
            selection={chartSelection}
            visible={chartVisible}
            height={chartHeight}
            rsiHeight={rsiHeight}
            limitPerTF={limitPerTF}
            onRsiHeightChange={onRsiHeightChange}
            onToggleVisible={onToggleChart}
            onHeightChange={onChartHeightChange}
            timeframes={timeframes}
            onSelectChart={onSelectChart}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ConsensusTopPanel({
  result,
  market,
  timeframe,
  onSelectChart,
}: {
  result: ScanResult;
  market: Market;
  timeframe: Timeframe;
  onSelectChart: (selection: ChartSelection) => void;
}) {
  const bullish = result.consensusTop?.bullish ?? [];
  const bearish = result.consensusTop?.bearish ?? [];

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <ConsensusTopList
        title="Top 10 Bullish đồng thuận"
        description="Coin có tín hiệu Bullish đồng thuận trên toàn bộ khung đã chọn."
        rows={bullish}
        signal="BULLISH"
        emptyText="Chưa có coin Bullish đồng thuận tuyệt đối."
        market={market}
        timeframe={timeframe}
        onSelectChart={onSelectChart}
      />
      <ConsensusTopList
        title="Top 10 Bearish đồng thuận"
        description="Coin có tín hiệu Bearish đồng thuận trên toàn bộ khung đã chọn."
        rows={bearish}
        signal="BEARISH"
        emptyText="Chưa có coin Bearish đồng thuận tuyệt đối."
        market={market}
        timeframe={timeframe}
        onSelectChart={onSelectChart}
      />
    </div>
  );
}

function ConsensusTopList({
  title,
  description,
  rows,
  signal,
  emptyText,
  market,
  timeframe,
  onSelectChart,
}: {
  title: string;
  description: string;
  rows: ConsensusTopEntry[];
  signal: "BULLISH" | "BEARISH";
  emptyText: string;
  market: Market;
  timeframe: Timeframe;
  onSelectChart: (selection: ChartSelection) => void;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="mb-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <SignalPill signal={signal} compact />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="grid h-24 place-items-center rounded-md border border-dashed text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <ConsensusTopRow
              key={`${signal}-${row.symbol}`}
              index={index}
              row={row}
              market={market}
              timeframe={timeframe}
              onSelectChart={onSelectChart}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConsensusTopRow({
  index,
  row,
  market,
  timeframe,
  onSelectChart,
}: {
  index: number;
  row: ConsensusTopEntry;
  market: Market;
  timeframe: Timeframe;
  onSelectChart: (selection: ChartSelection) => void;
}) {
  const chartUrl = tradingViewUrl({ symbol: row.symbol, market, timeframe });
  const analysisHref = `/scanner/analysis/${market.toLowerCase()}/${row.symbol}`;

  return (
    <div className="group flex w-full items-center gap-2 rounded-md border bg-background/60 px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-primary/5">
      {/* Primary tap target: deep-analysis page. Styled to look obviously
          clickable — primary-color symbol, sparkles icon hint, hover row. */}
      <Link
        href={analysisHref}
        className="flex flex-1 items-center gap-2 text-left"
        prefetch={false}
        title={`Mở phân tích AI cho ${row.symbol}`}
      >
        <span className="num w-5 text-xs tabular-nums text-muted-foreground">
          #{index + 1}
        </span>
        <span className="font-mono text-sm font-medium text-foreground underline decoration-primary/40 decoration-dotted underline-offset-4 group-hover:text-primary group-hover:decoration-primary">
          {row.symbol}
        </span>
        <Sparkles className="size-3 text-primary opacity-50 transition-opacity group-hover:opacity-100" />
        <span className="hidden text-[10px] uppercase tracking-wide text-primary opacity-0 transition-opacity group-hover:opacity-100 sm:inline">
          Phân tích AI
        </span>
      </Link>
      {/* Follow: add to the Telegram consensus watchlist. */}
      {market === "CRYPTO" ? <FollowButton symbol={row.symbol} /> : null}
      {/* Secondary: inline chart preview. */}
      <button
        type="button"
        className="inline-flex items-center rounded-md border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => onSelectChart({ symbol: row.symbol, market, timeframe })}
        aria-label={`Xem chart ${row.symbol} bên dưới`}
        title="Hiển thị chart phía dưới"
      >
        <LineChartIcon className="size-3" />
      </button>
      <a
        href={chartUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center rounded-md border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={(event) => event.stopPropagation()}
        aria-label={`Mở ${row.symbol} trên TradingView`}
        title="Mở TradingView (tab mới)"
      >
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

// TradingView URL builders moved to `lib/scanner/tradingview.ts` so the
// analysis detail page can reuse them. Re-imported above.

type RsiPoint = {
  index: number;
  rsi: number | null;
  ema: number | null;
  wma: number | null;
};

function buildRsiSeries(closes: number[]): RsiPoint[] {
  const rsiSeries = rsi(closes, 14);
  const emaSeries = ema(rsiSeries, 9);
  const wmaSeries = wma(rsiSeries, 45);
  return closes.map((_, index) => ({
    index: index + 1,
    rsi: Number.isFinite(rsiSeries[index]) ? rsiSeries[index] : null,
    ema: Number.isFinite(emaSeries[index]) ? emaSeries[index] : null,
    wma: Number.isFinite(wmaSeries[index]) ? wmaSeries[index] : null,
  }));
}

function TradingViewPanel({
  selection,
  visible,
  height,
  rsiHeight,
  limitPerTF,
  onRsiHeightChange,
  onToggleVisible,
  onHeightChange,
  timeframes,
  onSelectChart,
}: {
  selection: ChartSelection | null;
  visible: boolean;
  height: number;
  rsiHeight: number;
  limitPerTF: number;
  onRsiHeightChange: (height: number) => void;
  onToggleVisible: () => void;
  onHeightChange: (height: number) => void;
  timeframes: Timeframe[];
  onSelectChart: (selection: ChartSelection) => void;
}) {
  const startResize = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const startY = event.clientY;
      const startHeight = height;
      const pointerId = event.pointerId;
      const target = event.currentTarget;
      target.setPointerCapture(pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        const nextHeight = Math.min(
          MAX_CHART_HEIGHT,
          Math.max(MIN_CHART_HEIGHT, startHeight + moveEvent.clientY - startY),
        );
        onHeightChange(nextHeight);
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        target.releasePointerCapture(pointerId);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        const nextHeight = Math.min(
          MAX_CHART_HEIGHT,
          Math.max(MIN_CHART_HEIGHT, startHeight + upEvent.clientY - startY),
        );
        window.localStorage.setItem(CHART_HEIGHT_STORAGE_KEY, String(nextHeight));
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [height, onHeightChange],
  );

  if (!selection) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed bg-card/40 p-4 text-center text-sm text-muted-foreground">
        <div className="space-y-3">
          <div>Bấm vào symbol để mở chart TradingView.</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onToggleVisible}
          >
            {visible ? (
              <>
                <EyeOff className="size-3.5" />
                Ẩn chart
              </>
            ) : (
              <>
                <Eye className="size-3.5" />
                Hiện chart
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card/40">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <div className="font-mono text-sm font-medium">
            {tradingViewSymbol(selection)}
          </div>
          <div className="text-xs text-muted-foreground">
            TradingView · RSI(14), EMA(9), WMA(45) trên RSI
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {timeframes.map((tf) => (
              <Button
                key={tf}
                type="button"
                size="xs"
                variant={tf === selection.timeframe ? "secondary" : "outline"}
                onClick={() => onSelectChart({ ...selection, timeframe: tf })}
              >
                {tf}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onToggleVisible}
          >
            {visible ? (
              <>
                <EyeOff className="size-3.5" />
                Ẩn chart
              </>
            ) : (
              <>
                <Eye className="size-3.5" />
                Hiện chart
              </>
            )}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => window.open(tradingViewUrl(selection), "_blank")}
            aria-label="Mở chart TradingView trong tab mới"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>
      {visible ? (
        <>
          <TradingViewWidget
            key={`${selection.market}-${selection.symbol}-${selection.timeframe}`}
            selection={selection}
            height={height}
          />
          <RsiPanel
            selection={selection}
            height={rsiHeight}
            limit={limitPerTF}
            onHeightChange={onRsiHeightChange}
          />
          <button
            type="button"
            className="flex h-8 w-full cursor-ns-resize items-center justify-center rounded-b-lg border-t bg-muted/30 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60"
            onPointerDown={startResize}
            aria-label="Kéo để đổi chiều cao chart"
            title="Kéo lên/xuống để đổi chiều cao chart"
          >
            Kéo để đổi chiều cao · {height}px
          </button>
        </>
      ) : (
        <div className="grid h-24 place-items-center rounded-b-lg border-t border-dashed text-sm text-muted-foreground">
          Chart đang ẩn. Bấm “Hiện chart” để mở lại.
        </div>
      )}
    </div>
  );
}

function TradingViewWidget({
  selection,
  height,
}: {
  selection: ChartSelection;
  height: number;
}) {
  const src = `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(
    tradingViewSymbol(selection),
  )}&interval=${encodeURIComponent(
    tradingViewInterval(selection.timeframe),
  )}&theme=dark&style=1&timezone=Asia/Ho_Chi_Minh&withdateranges=1&locale=vi_VN`;

  return (
    <div className="overflow-hidden rounded-b-lg border-t" style={{ height }}>
      <iframe
        key={src}
        src={src}
        title="TradingView Preview"
        className="h-full w-full"
        allowTransparency
        frameBorder="0"
      />
    </div>
  );
}

function RsiPanel({
  selection,
  height,
  limit,
  onHeightChange,
}: {
  selection: ChartSelection;
  height: number;
  limit: number;
  onHeightChange: (height: number) => void;
}) {
  const startResize = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const startY = event.clientY;
      const startHeight = height;
      const pointerId = event.pointerId;
      const target = event.currentTarget;
      target.setPointerCapture(pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        const nextHeight = Math.min(
          MAX_RSI_HEIGHT,
          Math.max(MIN_RSI_HEIGHT, startHeight + moveEvent.clientY - startY),
        );
        onHeightChange(nextHeight);
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        target.releasePointerCapture(pointerId);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        const nextHeight = Math.min(
          MAX_RSI_HEIGHT,
          Math.max(MIN_RSI_HEIGHT, startHeight + upEvent.clientY - startY),
        );
        window.localStorage.setItem(
          RSI_HEIGHT_STORAGE_KEY,
          String(nextHeight),
        );
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [height, onHeightChange],
  );

  const rsiQuery = useQuery({
    queryKey: [
      "scanner-rsi",
      selection.market,
      selection.symbol,
      selection.timeframe,
      limit,
    ],
    queryFn: async () => {
      const res = await fetch("/api/scanner/candles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: selection.market,
          symbol: selection.symbol,
          timeframe: selection.timeframe,
          limit,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tải RSI thất bại");
      return data as { closes: number[] };
    },
  });

  const series = React.useMemo(() => {
    if (!rsiQuery.data?.closes?.length) return [];
    return buildRsiSeries(rsiQuery.data.closes);
  }, [rsiQuery.data]);

  return (
    <div className="border-t bg-card/50 px-3 py-3">
      <div className="mb-2 text-xs text-muted-foreground">
        RSI(14) + EMA(9) + WMA(45) trên RSI
      </div>
      <div style={{ height }} className="w-full">
        {rsiQuery.isLoading ? (
          <div className="grid h-full place-items-center rounded-md border border-dashed text-xs text-muted-foreground">
            Đang tải RSI…
          </div>
        ) : rsiQuery.isError ? (
          <div className="grid h-full place-items-center rounded-md border border-dashed text-xs text-destructive">
            {(rsiQuery.error as Error).message}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <XAxis dataKey="index" hide />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value) =>
                  typeof value === "number" ? value.toFixed(2) : value
                }
                labelFormatter={() => ""}
              />
              <ReferenceLine y={70} stroke="#9ca3af" strokeDasharray="4 4" />
              <ReferenceLine y={30} stroke="#9ca3af" strokeDasharray="4 4" />
              <ReferenceLine y={50} stroke="#9ca3af" strokeDasharray="2 4" />
              <Line
                type="monotone"
                dataKey="rsi"
                stroke="#E040FB"
                strokeWidth={1}
                dot={false}
                name="RSI"
              />
              <Line
                type="monotone"
                dataKey="ema"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                name="EMA 9"
              />
              <Line
                type="monotone"
                dataKey="wma"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                name="WMA 45"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <button
        type="button"
        className="mt-2 flex h-7 w-full cursor-ns-resize items-center justify-center rounded-md border bg-muted/30 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60"
        onPointerDown={startResize}
        aria-label="Kéo để đổi chiều cao RSI"
        title="Kéo lên/xuống để đổi chiều cao RSI"
      >
        Kéo để đổi chiều cao RSI · {height}px
      </button>
    </div>
  );
}

function SummaryRow({
  row,
  market,
  timeframes,
  selectedSymbol,
  onSelectChart,
}: {
  row: ScanSummaryEntry;
  market: Market;
  timeframes: Timeframe[];
  selectedSymbol: string | null;
  onSelectChart: (selection: ChartSelection) => void;
}) {
  const tfMap = new Map<string, PerTimeframeResult>();
  for (const t of row.perTF) tfMap.set(t.timeframe, t);

  // The runner records a failed candle fetch as signal NEUTRAL + an error
  // string, so a symbol that never loaded still aggregates to score 50 /
  // "Hỗn hợp" — visually identical to a coin we really did analyse. The
  // input accepts free-typed symbols (BTCUSD, SOL/USD, PEPEUSDT.P), so
  // this is easy to hit. Show it as missing data instead of a fake score,
  // and put the reason on screen — the per-TF `title` is hover-only and
  // therefore invisible on touch.
  const failedTFs = row.perTF.filter((t) => t.error);
  const allFailed =
    row.perTF.length > 0 && failedTFs.length === row.perTF.length;
  const failReason = failedTFs[0]?.error;

  if (allFailed) {
    return (
      <TableRow className="bg-destructive/5 hover:bg-destructive/10">
        <TableCell>
          {/* No chart button and no follow bell: there is nothing to chart
              and an alert on a symbol we can't fetch would never fire. */}
          <span className="font-mono text-sm font-medium text-muted-foreground">
            {row.symbol}
          </span>
        </TableCell>
        <TableCell
          colSpan={2 + timeframes.length}
          className="whitespace-normal"
        >
          <div className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-medium">
                Không lấy được dữ liệu — chưa chấm điểm.
              </span>{" "}
              {failReason ? `${failReason} ` : ""}
              Kiểm tra lại tên symbol (đúng dạng BTCUSDT) rồi quét lại.
            </span>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  const alignment: SignalLike =
    row.alignment === "BULLISH"
      ? "BULLISH"
      : row.alignment === "BEARISH"
        ? "BEARISH"
        : "MIXED";

  return (
    <TableRow
      className={
        selectedSymbol === row.symbol ? "bg-primary/5 hover:bg-primary/10" : ""
      }
    >
      <TableCell>
        <div className="flex items-center gap-2">
          {/* Follow ANY coin you scanned — not just the algo's Top-10 —
              so you can watch your own picks for consensus / break. */}
          {market === "CRYPTO" ? <FollowButton symbol={row.symbol} /> : null}
          <div className="min-w-0">
            <button
              type="button"
              className="font-mono text-sm font-medium underline-offset-4 hover:underline"
              onClick={() =>
                onSelectChart({
                  symbol: row.symbol,
                  market,
                  timeframe: ALL_TIMEFRAMES.includes(timeframes[0] ?? "1h")
                    ? (timeframes[0] ?? "1h")
                    : DEFAULT_CHART_TIMEFRAME,
                })
              }
            >
              {row.symbol}
            </button>
            {failedTFs.length > 0 ? (
              // Partial failure: the runner counts every failed timeframe
              // as neutral, so the score next to it is diluted — say so
              // instead of letting the number look complete.
              <p className="max-w-[18rem] whitespace-normal text-[11px] leading-snug text-warning">
                {failedTFs.length}/{row.perTF.length} khung lỗi (
                {failedTFs.map((t) => t.timeframe).join(", ")}) — điểm chưa đầy
                đủ. {failReason}
              </p>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <ScoreBar value={row.score} />
      </TableCell>
      <TableCell>
        <SignalPill signal={alignment} />
      </TableCell>
      {timeframes.map((tf) => {
        const cell = tfMap.get(tf);
        if (!cell) {
          return (
            <TableCell key={tf} className="text-center text-muted-foreground">
              –
            </TableCell>
          );
        }
        if (cell.error) {
          return (
            <TableCell key={tf} className="text-center">
              <span
                className="inline-flex h-5 items-center rounded-md bg-destructive/10 px-1.5 text-[11px] text-destructive"
                title={cell.error}
              >
                lỗi
              </span>
            </TableCell>
          );
        }
        return (
          <TableCell key={tf} className="text-center">
            <button
              type="button"
              className="rounded-md transition-opacity hover:opacity-80"
              onClick={() =>
                onSelectChart({
                  symbol: row.symbol,
                  market,
                  timeframe: tf,
                })
              }
              title={`Mở chart ${row.symbol} khung ${tf}`}
            >
              <SignalPill signal={cell.signal} compact />
            </button>
          </TableCell>
        );
      })}
    </TableRow>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stale-result banner — shows when result was restored from sessionStorage
// after navigating back from the analysis page. Makes "this is N min old"
// loud so the user doesn't act on stale data thinking it's fresh.
// ──────────────────────────────────────────────────────────────────────
function StaleResultBanner({
  savedAt,
  loading,
  hasResult,
}: {
  savedAt: number | null;
  loading: boolean;
  hasResult: boolean;
}) {
  const [nowMs, setNowMs] = React.useState<number | null>(null);

  // Tick the clock every 30s so the "X phút trước" stays roughly right
  // without spamming re-renders.
  React.useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!hasResult || !savedAt || loading || nowMs === null) return null;
  const ageMs = nowMs - savedAt;
  // Don't bother with a banner for fresh results — likely still on the
  // same render after Quét.
  if (ageMs < 30_000) return null;

  const min = Math.floor(ageMs / 60_000);
  const label =
    min < 1 ? "vừa xong" : min < 60 ? `${min} phút trước` : `${Math.floor(min / 60)} giờ trước`;
  const isOld = min >= 5;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs",
        isOld
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <span>
        Kết quả từ <span className="font-medium">{label}</span>. Bấm Quét để
        cập nhật.
      </span>
    </div>
  );
}



// ──────────────────────────────────────────────────────────────────────
// Watchlist — feeds the 15-minute Telegram consensus alert
// ──────────────────────────────────────────────────────────────────────
//
// Moved here from the removed /insights page: the scanner is where users
// discover coins, so following them for alerts belongs on the same screen.
// The consensus cron reads WatchlistSymbol (market CRYPTO) directly.

type WatchlistItem = { id: string; symbol: string; market: string };

function useWatchlist() {
  const queryClient = useQueryClient();
  const list = useQuery<{ items: WatchlistItem[] }>({
    queryKey: ["watchlist", "CRYPTO"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/watchlist?market=CRYPTO", { signal });
      if (!res.ok) throw new Error("Không tải được watchlist");
      return (await res.json()) as { items: WatchlistItem[] };
    },
    staleTime: 60_000,
  });

  const add = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, market: "CRYPTO" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Thêm thất bại");
      return j as WatchlistItem;
    },
    onSuccess: (item) => {
      toast.success(
        `Đã theo dõi ${item.symbol} — sẽ báo Telegram khi trạng thái đồng thuận THAY ĐỔI (đạt mới / gãy).`,
      );
      queryClient.invalidateQueries({ queryKey: ["watchlist", "CRYPTO"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Thêm thất bại");
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Xoá thất bại");
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", "CRYPTO"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Xoá thất bại");
    },
  });

  return { list, add, remove };
}

// Global consensus-alert config — the full shape the API stores. Lives
// here (not Settings) since the watchlist is where alerts are managed.
type ConsensusAlertConfig = {
  enabled: boolean;
  timeframes: string[];
  notifyBullish: boolean;
  notifyBearish: boolean;
  notifyBreak: boolean;
};

function WatchlistPanel() {
  const { list, add, remove } = useWatchlist();
  const queryClient = useQueryClient();
  const [input, setInput] = React.useState("");
  const items = list.data?.items ?? [];

  // Default TF set (global consensus config) + per-coin overrides.
  const config = useQuery<{ config: ConsensusAlertConfig }>({
    queryKey: ["consensus-config"],
    queryFn: async () => {
      const res = await fetch("/api/notify/consensus-config");
      if (!res.ok) throw new Error("config");
      return (await res.json()) as { config: ConsensusAlertConfig };
    },
    staleTime: 5 * 60_000,
  });
  const overridesQ = useQuery<{ overrides: Record<string, string[]> }>({
    queryKey: ["consensus-overrides"],
    queryFn: async () => {
      const res = await fetch("/api/notify/consensus-overrides");
      if (!res.ok) throw new Error("overrides");
      return (await res.json()) as { overrides: Record<string, string[]> };
    },
    staleTime: 60_000,
  });
  const defaultTfs = (config.data?.config.timeframes ?? [
    "1h",
    "4h",
    "1d",
    "1w",
  ]) as Timeframe[];
  const overrides = (overridesQ.data?.overrides ?? {}) as Record<
    string,
    Timeframe[]
  >;

  const saveOverride = async (symbol: string, tfs: Timeframe[] | null) => {
    const res = await fetch("/api/notify/consensus-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, timeframes: tfs }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      toast.error(j?.error ?? "Lưu khung riêng thất bại");
      return;
    }
    toast.success(
      tfs
        ? `${symbol}: canh riêng ${tfs.join("·")}`
        : `${symbol}: về khung mặc định`,
    );
    queryClient.invalidateQueries({ queryKey: ["consensus-overrides"] });
  };

  const submit = () => {
    const s = input.trim().toUpperCase().replace(/[/\s]/g, "");
    if (!s) return;
    add.mutate(s);
    setInput("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-primary" />
          Watchlist · báo Telegram
        </CardTitle>
        <CardDescription>
          Quét mỗi 15 phút, chỉ báo <strong>thay đổi</strong> sau khi bạn
          theo dõi: coin <em>đạt</em> đồng thuận mới, hoặc coin đang đồng
          thuận <em>gãy cấu trúc</em> (tín hiệu thoát). Bật 🔔 trên coin
          Top 10 = canh điểm gãy cho vị thế đang giữ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            className="num flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Thêm coin: SUIUSDT…"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!input.trim() || add.isPending}
            onClick={submit}
          >
            <Plus className="size-4" />
          </Button>
        </div>

        {list.isLoading ? (
          <p className="text-xs text-muted-foreground">Đang tải…</p>
        ) : items.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Chưa theo dõi coin nào — thêm coin để nhận tín hiệu đồng thuận
            qua Telegram.
          </p>
        ) : (
          <div className="space-y-1.5">
            {items.map((w) => (
              <WatchlistRow
                key={w.id}
                symbol={w.symbol}
                defaultTfs={defaultTfs}
                override={overrides[w.symbol.toUpperCase()] ?? null}
                onRemove={() => remove.mutate(w.id)}
                onSaveOverride={(tfs) => saveOverride(w.symbol, tfs)}
              />
            ))}
          </div>
        )}
        <ConsensusConfigSection config={config.data?.config ?? null} />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Bấm khung trên từng coin để đặt riêng thay cho khung mặc định.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Global alert config (default TF set + directions + on/off), inline in the
 * watchlist panel — moved here from Settings so everything consensus-alert
 * lives in one place. Collapsed to a one-line summary until opened.
 */
function ConsensusConfigSection({
  config,
}: {
  config: ConsensusAlertConfig | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ConsensusAlertConfig | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Alerts deliver via Telegram only — warn instead of letting the user
  // configure signals that silently go nowhere. (The old Settings card
  // hid itself entirely; a visible hint is more actionable.)
  const telegram = useQuery<{ connected?: boolean }>({
    queryKey: ["telegram-status"],
    queryFn: async () => {
      const res = await fetch("/api/notify/telegram");
      if (!res.ok) return {};
      return (await res.json()) as { connected?: boolean };
    },
    // Always re-check on mount: the Settings card saves via raw fetch and
    // can't invalidate this cache, so a staleTime would keep showing "chưa
    // kết nối" after the user follows the link and connects Telegram.
    refetchOnMount: "always",
  });

  if (!config) return null;

  const openEditor = () => {
    setDraft({ ...config, timeframes: [...config.timeframes] });
    setOpen(true);
  };

  const toggleTf = (tf: Timeframe) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            timeframes: d.timeframes.includes(tf)
              ? d.timeframes.filter((t) => t !== tf)
              : // Keep chronological order by re-filtering the master list.
                ALERT_TFS.filter(
                  (t) => d.timeframes.includes(t as Timeframe) || t === tf,
                ),
          }
        : d,
    );

  const save = async () => {
    if (!draft) return;
    if (draft.timeframes.length < 1) {
      toast.error("Chọn ít nhất 1 khung.");
      return;
    }
    if (!draft.notifyBullish && !draft.notifyBearish) {
      toast.error("Bật ít nhất một hướng (Bullish hoặc Bearish).");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/notify/consensus-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const d = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(d?.error ?? `Lỗi ${res.status}`);
        return;
      }
      toast.success(
        `Đã lưu: canh ${draft.timeframes.join("·")} · ${[
          draft.notifyBullish ? "Bullish" : null,
          draft.notifyBearish ? "Bearish" : null,
        ]
          .filter(Boolean)
          .join(" + ")}`,
      );
      queryClient.invalidateQueries({ queryKey: ["consensus-config"] });
      setOpen(false);
    } catch {
      // fetch itself rejected (offline / server unreachable) — without this
      // the spinner just stops silently and the user assumes it saved.
      toast.error("Không gửi được yêu cầu — kiểm tra kết nối mạng.");
    } finally {
      setSaving(false);
    }
  };

  const summary = config.enabled
    ? `${config.timeframes.join("·")} ${[
        config.notifyBullish ? "📈" : null,
        config.notifyBearish ? "📉" : null,
        config.notifyBreak ? "⚠️" : null,
      ]
        .filter(Boolean)
        .join("")}`
    : "đang tắt";

  return (
    <div className="rounded-md border bg-card/40 p-2">
      {telegram.data?.connected === false ? (
        <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          Chưa kết nối Telegram — tín hiệu sẽ không gửi được.{" "}
          <Link href="/settings" className="font-medium underline">
            Kết nối ở Cài đặt
          </Link>
          .
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openEditor())}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Settings2 className="size-3.5 text-muted-foreground" />
          Khung mặc định &amp; hướng báo
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {summary}
        </span>
      </button>

      {open && draft ? (
        <div className="mt-2 space-y-3 border-t pt-2">
          <label className="flex cursor-pointer items-center justify-between gap-2">
            <span className="text-xs">Bật tín hiệu đồng thuận</span>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(v) =>
                setDraft((d) => (d ? { ...d, enabled: !!v } : d))
              }
            />
          </label>

          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">
              Các khung phải cùng đồng thuận (coin không đặt riêng dùng bộ
              này):
            </span>
            <div className="flex flex-wrap gap-1">
              {ALERT_TFS.map((tf) => {
                const active = draft.timeframes.includes(tf);
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => toggleTf(tf)}
                    disabled={!draft.enabled}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition",
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-card/40 text-muted-foreground hover:text-foreground",
                      !draft.enabled && "pointer-events-none opacity-50",
                    )}
                  >
                    {tf}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Nhiều khung = hiếm tín hiệu nhưng chắc; 1 khung = nhạy, nhiều
              tin hơn.
            </p>
          </div>

          <div className="space-y-1.5">
            {(
              [
                ["notifyBullish", "📈 Báo đồng thuận BULLISH"],
                ["notifyBearish", "📉 Báo đồng thuận BEARISH"],
                [
                  "notifyBreak",
                  "⚠️ Báo khi MẤT đồng thuận (tín hiệu thoát)",
                ],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md border bg-card/40 px-2.5 py-1.5"
              >
                <span className="text-xs">{label}</span>
                <Switch
                  checked={draft[key]}
                  disabled={!draft.enabled}
                  onCheckedChange={(v) =>
                    setDraft((d) => (d ? { ...d, [key]: !!v } : d))
                  }
                />
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Lưu
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Đóng
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ALERT_TFS: Timeframe[] = ["15m", "1h", "4h", "1d", "1w", "1M"];

function WatchlistRow({
  symbol,
  defaultTfs,
  override,
  onRemove,
  onSaveOverride,
}: {
  symbol: string;
  defaultTfs: Timeframe[];
  override: Timeframe[] | null;
  onRemove: () => void;
  onSaveOverride: (tfs: Timeframe[] | null) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const effective = override ?? defaultTfs;
  const [draft, setDraft] = React.useState<Timeframe[]>(effective);

  const toggle = (tf: Timeframe) =>
    setDraft((d) =>
      d.includes(tf)
        ? d.filter((x) => x !== tf)
        : ALERT_TFS.filter((x) => d.includes(x) || x === tf),
    );

  return (
    <div className="rounded-md border bg-card/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{symbol}</span>
          <button
            type="button"
            onClick={() => {
              setDraft(effective);
              setEditing((v) => !v);
            }}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] transition",
              override
                ? "border-primary/40 bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Đặt khung riêng cho coin này"
          >
            {effective.join("·")}
            {override ? " ·riêng" : " ·mặc định"}
          </button>
        </div>
        <button
          type="button"
          className="rounded-full p-0.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          aria-label={`Bỏ theo dõi ${symbol}`}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div className="flex flex-wrap gap-1">
            {ALERT_TFS.map((tf) => {
              const active = draft.includes(tf);
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => toggle(tf)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-mono text-[10px] transition",
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tf}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              disabled={draft.length < 1}
              onClick={() => {
                onSaveOverride(draft);
                setEditing(false);
              }}
            >
              Lưu khung riêng
            </Button>
            {override ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  onSaveOverride(null);
                  setEditing(false);
                }}
              >
                Về mặc định
              </Button>
            ) : null}
            <span className="text-[10px] text-muted-foreground">
              1 khung = báo theo tín hiệu khung đó (nhạy hơn)
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Bell toggle on a Top-10 consensus row — follow/unfollow in one tap. */
function FollowButton({ symbol }: { symbol: string }) {
  const { list, add, remove } = useWatchlist();
  const existing = (list.data?.items ?? []).find(
    (w) => w.symbol.toUpperCase() === symbol.toUpperCase(),
  );

  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center rounded-md border p-1.5 transition-colors",
        existing
          ? "border-primary/40 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
      disabled={add.isPending || remove.isPending}
      onClick={() => {
        if (existing) remove.mutate(existing.id);
        else add.mutate(symbol);
      }}
      aria-label={
        existing ? `Bỏ theo dõi ${symbol}` : `Theo dõi ${symbol} (báo Telegram)`
      }
      title={
        existing
          ? "Đang theo dõi — bấm để bỏ"
          : "Theo dõi: báo Telegram khi coin này MẤT đồng thuận (tín hiệu thoát) hoặc đạt đồng thuận mới"
      }
    >
      {existing ? <BellRing className="size-3" /> : <Bell className="size-3" />}
    </button>
  );
}
