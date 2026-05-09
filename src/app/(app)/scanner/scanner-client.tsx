"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Radar, Plus, X } from "lucide-react";

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
import type {
  PerTimeframeResult,
  ScanResult,
  ScanSummaryEntry,
} from "@/lib/scanner/runner";
import { SignalPill, ScoreBar, type SignalLike } from "./signal-pill";

type Market = "FOREX" | "CRYPTO";

const DEFAULT_FOREX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"];
const DEFAULT_CRYPTO = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

type FormState = {
  market: Market;
  symbols: string[];
  timeframes: Timeframe[];
  limitPerTF: string;
};

const initialState = (): FormState => ({
  market: "CRYPTO",
  symbols: [...DEFAULT_CRYPTO],
  timeframes: [...ALL_TIMEFRAMES],
  limitPerTF: "200",
});

export function ScannerClient() {
  const [state, setState] = React.useState<FormState>(initialState);
  const [pickerSymbol, setPickerSymbol] = React.useState("");
  const [customSymbol, setCustomSymbol] = React.useState("");
  const [result, setResult] = React.useState<ScanResult | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const onMarketChange = (m: string | null) => {
    if (!m) return;
    const market = m as Market;
    setState({
      ...initialState(),
      market,
      symbols: market === "FOREX" ? [...DEFAULT_FOREX] : [...DEFAULT_CRYPTO],
    });
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
    mutationFn: async () => {
      const limitPerTF = Number(state.limitPerTF) || 200;
      const res = await fetch("/api/scanner/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: state.market,
          symbols: state.symbols,
          timeframes: state.timeframes,
          indicators: [DEFAULT_STRATEGY],
          limitPerTF,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Quét thất bại");
      return data as ScanResult;
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success(`Đã quét ${data.summary.length} symbol.`);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Lỗi không xác định"),
  });

  const canRun =
    state.symbols.length > 0 &&
    state.timeframes.length > 0 &&
    !runScan.isPending;

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
            <strong>Quét</strong>. Bullish khi đường EMA(9) cắt lên trên đường
            WMA(45) trên RSI(14).
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
            {state.market === "CRYPTO" ? (
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
            ) : null}

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

          <div className="space-y-1.5">
            <Label>Số nến mỗi TF</Label>
            <Input
              inputMode="numeric"
              className="num"
              value={state.limitPerTF}
              onChange={(e) => update("limitPerTF", e.target.value)}
              placeholder="200"
            />
            <p className="text-xs text-muted-foreground">
              50–1000. Mặc định 200, đủ cho EMA/WMA dài.
            </p>
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={!canRun}
            onClick={() => runScan.mutate()}
          >
            {runScan.isPending ? "Đang quét…" : "Quét"}
          </Button>
        </CardContent>
      </Card>

      <ResultsPanel
        result={result}
        timeframes={state.timeframes}
        loading={runScan.isPending}
      />
    </div>
  );
}

function ResultsPanel({
  result,
  timeframes,
  loading,
}: {
  result: ScanResult | null;
  timeframes: Timeframe[];
  loading: boolean;
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
              {result.summary.length} symbol · sắp xếp theo điểm giảm dần
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-[11px]">
            run #{result.runId.slice(0, 8)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
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
              <SummaryRow key={row.symbol} row={row} timeframes={timeframes} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SummaryRow({
  row,
  timeframes,
}: {
  row: ScanSummaryEntry;
  timeframes: Timeframe[];
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
    <TableRow>
      <TableCell className="font-mono text-sm">{row.symbol}</TableCell>
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
            <SignalPill signal={cell.signal} compact />
          </TableCell>
        );
      })}
    </TableRow>
  );
}

