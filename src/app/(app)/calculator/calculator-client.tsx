"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, RefreshCw } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { InstrumentCombobox } from "@/components/instrument-combobox";
import { ACCOUNT_CURRENCIES, findForexPair } from "@/lib/calc/forex-pairs";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types (mirror /api/calc/position-size response)
// ──────────────────────────────────────────────────────────────────────
type PositionResult = {
  market: "FOREX" | "CRYPTO";
  riskAmount: number;
  stopLossPips?: number;
  stopLossDistance: number;
  pipValuePerLotInAccount?: number;
  positionSize: {
    units: number;
    standardLots?: number;
    miniLots?: number;
    microLots?: number;
  };
  notional: number;
  notionalInAccount: number;
  warnings: string[];
  meta: {
    symbol: string;
    display: string;
    pipSize?: number;
    quoteCurrency: string;
    quoteToAccountRate: number;
  };
};

type StopMode = "pips" | "price";

type FormState = {
  market: "FOREX" | "CRYPTO";
  accountCurrency: string;
  symbol: string;
  riskAmount: string;
  stopMode: StopMode;       // FX: pips | price; Crypto: always price
  stopPips: string;         // FX (pips mode)
  entryPrice: string;       // FX (price mode) + Crypto
  stopPrice: string;        // FX (price mode) + Crypto
};

const INITIAL_STATE: FormState = {
  market: "FOREX",
  accountCurrency: "USD",
  symbol: "GBPUSD",
  riskAmount: "5",
  stopMode: "pips",
  stopPips: "51.2",
  entryPrice: "",
  stopPrice: "",
};

// Allow comma decimals (European style) in number inputs.
const num = (s: string): number => Number(String(s).replace(",", "."));

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────
export function CalculatorClient() {
  const [state, setState] = React.useState<FormState>(INITIAL_STATE);
  const [result, setResult] = React.useState<PositionResult | null>(null);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const fetchPrice = useMutation({
    mutationFn: async () => {
      const url = new URL("/api/quote", window.location.origin);
      url.searchParams.set("market", state.market);
      url.searchParams.set("symbol", state.symbol);
      const res = await fetch(url);
      const data = (await res.json()) as { price?: number; error?: string };
      if (!res.ok || typeof data.price !== "number") {
        throw new Error(data.error ?? "Failed to fetch price");
      }
      return data.price;
    },
    onSuccess: (price) => {
      const formatted =
        state.market === "FOREX"
          ? price.toFixed(findForexPair(state.symbol)?.digits ?? 5)
          : String(price);
      update("entryPrice", formatted);
      toast.success(`${state.symbol} = ${formatted}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Lỗi"),
  });

  const calculate = useMutation({
    mutationFn: async () => {
      const body =
        state.market === "FOREX"
          ? {
              market: "FOREX",
              accountCurrency: state.accountCurrency,
              symbol: state.symbol,
              direction: "LONG",
              entryPrice:
                state.stopMode === "price"
                  ? num(state.entryPrice)
                  : 1, // dummy; only used in price mode
              stopMode: state.stopMode,
              stopValue:
                state.stopMode === "pips"
                  ? num(state.stopPips)
                  : num(state.stopPrice),
              riskMode: "fixed",
              riskValue: num(state.riskAmount),
            }
          : {
              market: "CRYPTO",
              accountCurrency: state.accountCurrency,
              symbol: state.symbol,
              direction: "LONG",
              entryPrice: num(state.entryPrice),
              stopPrice: num(state.stopPrice),
              riskMode: "fixed",
              riskValue: num(state.riskAmount),
            };

      const res = await fetch("/api/calc/position-size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Tính toán thất bại");
      return data as PositionResult;
    },
    onSuccess: setResult,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Lỗi"),
  });

  const onMarketChange = (m: string) => {
    const market = m as "FOREX" | "CRYPTO";
    setState({
      market,
      accountCurrency: state.accountCurrency,
      symbol: market === "FOREX" ? "GBPUSD" : "BTCUSDT",
      riskAmount: state.riskAmount,
      stopMode: market === "FOREX" ? "pips" : "price",
      stopPips: "20",
      entryPrice: "",
      stopPrice: "",
    });
    setResult(null);
  };

  // ───────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="size-4 text-primary" />
            Thông số đầu vào
          </CardTitle>
          <CardDescription>
            Nhập số tiền risk và stop loss để tính khối lượng lệnh ra lots và
            units.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <Tabs value={state.market} onValueChange={onMarketChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="FOREX">Forex</TabsTrigger>
              <TabsTrigger value="CRYPTO">Crypto</TabsTrigger>
            </TabsList>

            {/* ─── FOREX ─────────────────────────────────────────── */}
            <TabsContent value="FOREX" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tiền tệ tài khoản">
                  <Select
                    value={state.accountCurrency}
                    onValueChange={(v) => v && update("accountCurrency", v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Cặp tiền">
                  <InstrumentCombobox
                    market="FOREX"
                    value={state.symbol}
                    onChange={(v) => update("symbol", v)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Số tiền risk">
                  <Input
                    inputMode="decimal"
                    className="num"
                    value={state.riskAmount}
                    onChange={(e) => update("riskAmount", e.target.value)}
                    placeholder="5"
                  />
                </Field>
                {state.stopMode === "pips" ? (
                  <Field label="Stop Loss (pips)">
                    <Input
                      inputMode="decimal"
                      className="num"
                      value={state.stopPips}
                      onChange={(e) => update("stopPips", e.target.value)}
                      placeholder="20"
                    />
                  </Field>
                ) : (
                  <Field label="Stop Loss (giá)">
                    <Input
                      inputMode="decimal"
                      className="num"
                      value={state.stopPrice}
                      onChange={(e) => update("stopPrice", e.target.value)}
                      placeholder="1.0820"
                    />
                  </Field>
                )}
              </div>

              <Tabs
                value={state.stopMode}
                onValueChange={(v) => update("stopMode", v as StopMode)}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="pips">SL theo pips</TabsTrigger>
                  <TabsTrigger value="price">SL theo giá</TabsTrigger>
                </TabsList>
              </Tabs>

              {state.stopMode === "price" ? (
                <Field label="Giá vào lệnh">
                  <div className="flex gap-2">
                    <Input
                      inputMode="decimal"
                      className="num"
                      value={state.entryPrice}
                      onChange={(e) => update("entryPrice", e.target.value)}
                      placeholder="1.0850"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fetchPrice.mutate()}
                      disabled={fetchPrice.isPending || !state.symbol}
                    >
                      <RefreshCw
                        className={cn(
                          "mr-1 size-4",
                          fetchPrice.isPending && "animate-spin",
                        )}
                      />
                      Live
                    </Button>
                  </div>
                </Field>
              ) : null}
            </TabsContent>

            {/* ─── CRYPTO ────────────────────────────────────────── */}
            <TabsContent value="CRYPTO" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tiền tệ tài khoản">
                  <Select
                    value={state.accountCurrency}
                    onValueChange={(v) => v && update("accountCurrency", v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Symbol">
                  <InstrumentCombobox
                    market="CRYPTO"
                    value={state.symbol}
                    onChange={(v) => update("symbol", v)}
                  />
                </Field>
              </div>

              <Field label="Số tiền risk">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.riskAmount}
                  onChange={(e) => update("riskAmount", e.target.value)}
                  placeholder="50"
                />
              </Field>

              <Field label="Giá vào lệnh">
                <div className="flex gap-2">
                  <Input
                    inputMode="decimal"
                    className="num"
                    value={state.entryPrice}
                    onChange={(e) => update("entryPrice", e.target.value)}
                    placeholder="0.00"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fetchPrice.mutate()}
                    disabled={fetchPrice.isPending || !state.symbol}
                  >
                    <RefreshCw
                      className={cn(
                        "mr-1 size-4",
                        fetchPrice.isPending && "animate-spin",
                      )}
                    />
                    Live
                  </Button>
                </div>
              </Field>

              <Field label="Giá Stop Loss">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.stopPrice}
                  onChange={(e) => update("stopPrice", e.target.value)}
                  placeholder="0.00"
                />
              </Field>
            </TabsContent>
          </Tabs>

          <Button
            type="button"
            className="w-full"
            disabled={calculate.isPending}
            onClick={() => calculate.mutate()}
          >
            {calculate.isPending ? "Đang tính…" : "Tính"}
          </Button>
        </CardContent>
      </Card>

      <ResultPanel state={state} result={result} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ResultPanel({
  state,
  result,
}: {
  state: FormState;
  result: PositionResult | null;
}) {
  if (!result) {
    return (
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-base">Kết quả</CardTitle>
          <CardDescription>
            Điền thông tin và bấm <strong>Tính</strong>.
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

  const fmt = (n: number, dp = 2) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }).format(n);

  const ccy = state.accountCurrency;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Kết quả</CardTitle>
          <Badge variant="outline" className="font-mono">
            {result.meta.display}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row label="Số tiền risk" value={`${ccy} ${fmt(result.riskAmount)}`} />
        <Separator />

        {result.market === "FOREX" ? (
          <>
            <Row
              label="Units"
              value={fmt(result.positionSize.units ?? 0, 0)}
            />
            <Row
              label="Standard Lots"
              value={fmt(result.positionSize.standardLots ?? 0, 4)}
              emphasis
            />
            <Row
              label="Mini Lots"
              value={fmt(result.positionSize.miniLots ?? 0, 3)}
            />
            <Row
              label="Micro Lots"
              value={fmt(result.positionSize.microLots ?? 0, 2)}
            />
            <Separator />
            <Row
              label={`Pip Value mỗi Lot (${ccy})`}
              value={fmt(result.pipValuePerLotInAccount ?? 0, 4)}
            />
            {result.stopLossPips != null ? (
              <Row
                label="Stop Loss"
                value={`${fmt(result.stopLossPips, 1)} pips`}
              />
            ) : null}
          </>
        ) : (
          <>
            <Row
              label={`Units (${result.meta.display.split(" / ")[0]})`}
              value={fmt(result.positionSize.units, 8)}
              emphasis
            />
            <Separator />
            <Row
              label={`Notional (${result.meta.quoteCurrency})`}
              value={fmt(result.notional)}
            />
            <Row
              label={`Notional (${ccy})`}
              value={fmt(result.notionalInAccount)}
            />
            <Row
              label="Khoảng cách Stop Loss"
              value={fmt(result.stopLossDistance, 8)}
            />
          </>
        )}

        {result.meta.quoteToAccountRate !== 1 ? (
          <>
            <Separator />
            <Row
              label={`${result.meta.quoteCurrency} → ${ccy}`}
              value={fmt(result.meta.quoteToAccountRate, 4)}
            />
          </>
        ) : null}

        {result.warnings.length > 0 ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            {result.warnings.map((w, i) => (
              <div key={i}>• {w}</div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn("num text-sm", emphasis && "text-base font-semibold")}
      >
        {value}
      </span>
    </div>
  );
}
