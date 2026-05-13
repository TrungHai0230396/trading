"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Eye, EyeOff, Radar, Plus, X } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
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

type Market = "FOREX" | "CRYPTO";

const DEFAULT_FOREX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"];
const DEFAULT_CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TIMEFRAMES_STORAGE_KEY = "scanner:selected-timeframes";
const LAST_RESULT_STORAGE_KEY = "scanner:last-result";
const CHART_HEIGHT_STORAGE_KEY = "scanner:chart-height";
const RSI_HEIGHT_STORAGE_KEY = "scanner:rsi-height";
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

type StoredScannerSnapshot = {
  state: FormState;
  result: ScanResult;
  chartSelection: ChartSelection | null;
  savedAt: string;
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

function parseStoredScannerSnapshot(
  value: string | null,
): StoredScannerSnapshot | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<StoredScannerSnapshot>;
    if (!parsed.state || !parsed.result) return null;
    if (parsed.state.market !== "FOREX" && parsed.state.market !== "CRYPTO") {
      return null;
    }
    if (!Array.isArray(parsed.state.symbols) || !parsed.state.symbols.length) {
      return null;
    }

    const timeframes = parsed.state.timeframes.filter((item): item is Timeframe =>
      (ALL_TIMEFRAMES as readonly string[]).includes(item),
    );
    if (!timeframes.length) return null;

    return {
      state: {
        market: parsed.state.market,
        symbols: parsed.state.symbols,
        timeframes,
        limitPerTF: parsed.state.limitPerTF || "200",
      },
      result: parsed.result,
      chartSelection: parsed.chartSelection ?? null,
      savedAt: parsed.savedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function normalizeChartSelection(selection: ChartSelection): ChartSelection {
  return selection.timeframe === "3d"
    ? { ...selection, timeframe: DEFAULT_CHART_TIMEFRAME }
    : selection;
}

export function ScannerClient() {
  const [state, setState] = React.useState<FormState>(initialState);
  const [pickerSymbol, setPickerSymbol] = React.useState("");
  const [customSymbol, setCustomSymbol] = React.useState("");
  const [result, setResult] = React.useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [chartSelection, setChartSelection] =
    React.useState<ChartSelection | null>(null);
  const [chartVisible, setChartVisible] = React.useState(true);
  const [chartHeight, setChartHeight] = React.useState(DEFAULT_CHART_HEIGHT);
  const [rsiHeight, setRsiHeight] = React.useState(DEFAULT_RSI_HEIGHT);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = parseStoredTimeframes(
        window.localStorage.getItem(TIMEFRAMES_STORAGE_KEY),
      );

      const snapshot = parseStoredScannerSnapshot(
        window.localStorage.getItem(LAST_RESULT_STORAGE_KEY),
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

      if (snapshot) {
        setState(snapshot.state);
        setResult(snapshot.result);
        const snapshotSelection = snapshot.chartSelection ??
          (snapshot.result.summary[0]
            ? {
                symbol: snapshot.result.summary[0].symbol,
                market: snapshot.state.market,
                timeframe: snapshot.state.timeframes[0] ?? "1h",
              }
            : null);

        setChartSelection(
          snapshotSelection ? normalizeChartSelection(snapshotSelection) : null,
        );
      } else if (stored) {
        setState((prev) =>
          prev.timeframes.join("|") === stored.join("|")
            ? prev
            : { ...prev, timeframes: stored },
        );
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
    const normalized = normalizeChartSelection(selection);

    setChartSelection(normalized);

    const snapshot = parseStoredScannerSnapshot(
      window.localStorage.getItem(LAST_RESULT_STORAGE_KEY),
    );
    if (snapshot) {
      window.localStorage.setItem(
        LAST_RESULT_STORAGE_KEY,
        JSON.stringify({
          ...snapshot,
          chartSelection: normalized,
          savedAt: new Date().toISOString(),
        } satisfies StoredScannerSnapshot),
      );
    }
  }, []);

  const onMarketChange = (m: string | null) => {
    if (!m) return;
    const market = m as Market;
    setState((prev) => ({
      ...initialState(),
      market,
      symbols: market === "FOREX" ? [...DEFAULT_FOREX] : [...DEFAULT_CRYPTO],
      timeframes: prev.timeframes,
    }));
    setPickerSymbol("");
    setCustomSymbol("");
    setResult(null);
  };

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Quét thất bại");
      return data as ScanResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setErrorMessage(null);
      setChartSelection((prev) => {
        const nextSelection =
          prev && data.summary.some((row) => row.symbol === prev.symbol)
            ? prev
            : data.summary[0]
              ? {
                  symbol: data.summary[0].symbol,
                  market: state.market,
                  timeframe: ALL_TIMEFRAMES.includes(
                    state.timeframes[0] ?? "1h",
                  )
                    ? (state.timeframes[0] ?? "1h")
                    : DEFAULT_CHART_TIMEFRAME,
                }
              : null;

        window.localStorage.setItem(
          LAST_RESULT_STORAGE_KEY,
          JSON.stringify({
            state,
            result: data,
            chartSelection: nextSelection,
            savedAt: new Date().toISOString(),
          } satisfies StoredScannerSnapshot),
        );

        return nextSelection;
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="size-4 text-primary" />
            Cấu hình quét
          </CardTitle>
          <CardDescription>
            Chọn thị trường, symbol và khung thời gian rồi bấm{" "}
            <strong>Quét coin đã chọn</strong>. Top 10 Bullish/Bearish đồng
            thuận là chức năng riêng, chỉ chạy khi bạn bấm nút quét Top 10.
            Danh sách Top 10 lấy theo market mặc định của hệ thống.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Thị trường</Label>
            <Tabs value={state.market} onValueChange={onMarketChange}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="FOREX">Forex</TabsTrigger>
                <TabsTrigger value="CRYPTO">Crypto</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

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
                placeholder={
                  state.market === "CRYPTO"
                    ? "Hoặc gõ symbol tùy chọn (vd: SUIUSDT)"
                    : "Hoặc gõ symbol tùy chọn (vd: EURUSD)"
                }
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
              Nút Top 10 dùng danh sách mặc định theo market và chỉ chạy khi
              bạn chủ động bấm. Mặc định hệ thống chỉ quét danh sách
              coin/symbol đã chọn.
            </p>
            {errorMessage ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <div className="font-medium">Lỗi quét: {errorMessage}</div>
                {errorMessage.toLowerCase().includes("twelve data") ||
                errorMessage.toLowerCase().includes("giới hạn") ? (
                  <div className="mt-1 text-destructive/80">
                    Forex intraday có thể bị giới hạn. Hãy thử lại sau hoặc
                    dùng khung 1D/1W/1M.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <ResultsPanel
        result={result}
        market={state.market}
        timeframes={state.timeframes}
        loading={runScan.isPending}
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
  );
}

function ResultsPanel({
  result,
  market,
  timeframes,
  loading,
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
  if (loading && !result) {
    return (
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-base">Kết quả</CardTitle>
          <CardDescription>Đang quét, vui lòng chờ…</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid h-72 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
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

  return (
    <div className="flex w-full items-center gap-2 rounded-md border bg-background/60 px-2.5 py-2">
      <button
        type="button"
        className="flex flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
        onClick={() => onSelectChart({ symbol: row.symbol, market, timeframe })}
      >
        <span className="num w-5 text-xs tabular-nums text-muted-foreground">
          #{index + 1}
        </span>
        <span className="font-mono text-sm font-medium">{row.symbol}</span>
      </button>
      <a
        href={chartUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center rounded-md border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={(event) => event.stopPropagation()}
        aria-label={`Mở chart ${row.symbol}`}
      >
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

function tradingViewSymbol(selection: ChartSelection): string {
  const raw = selection.symbol.toUpperCase().replace("/", "");
  if (raw.includes(":")) return raw;
  if (selection.market === "CRYPTO") return `BINANCE:${raw}`;
  return `OANDA:${raw}`;
}

function tradingViewInterval(timeframe: Timeframe): string {
  if (timeframe === "15m") return "15";
  if (timeframe === "1h") return "60";
  if (timeframe === "4h") return "240";
  if (timeframe === "1d") return "D";
  if (timeframe === "3d") return "3D";
  if (timeframe === "1w") return "W";
  return "M";
}

function tradingViewUrl(selection: ChartSelection): string {
  const symbol = encodeURIComponent(tradingViewSymbol(selection));
  return `https://www.tradingview.com/chart/?symbol=${symbol}&interval=${tradingViewInterval(selection.timeframe)}`;
}

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

