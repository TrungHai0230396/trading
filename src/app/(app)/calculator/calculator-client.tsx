"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, Calculator, RefreshCw } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
// Result type (mirrors API)
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
  rrRatio?: number;
  takeProfitPips?: number;
  expectedProfit?: number;
  warnings: string[];
  meta: {
    symbol: string;
    display: string;
    pipSize?: number;
    quoteCurrency: string;
    quoteToAccountRate: number;
  };
};

// ──────────────────────────────────────────────────────────────────────
// Shared form state
// ──────────────────────────────────────────────────────────────────────
type Direction = "LONG" | "SHORT";
type RiskMode = "percent" | "fixed";
type StopMode = "pips" | "price";

type FormState = {
  market: "FOREX" | "CRYPTO";
  accountCurrency: string;
  symbol: string;
  direction: Direction;
  entryPrice: string;
  stopMode: StopMode;          // FX
  stopValue: string;            // FX
  stopPrice: string;            // CRYPTO
  takeProfitPrice: string;
  riskMode: RiskMode;
  riskValue: string;
  accountBalance: string;
};

const INITIAL_STATE: FormState = {
  market: "FOREX",
  accountCurrency: "USD",
  symbol: "EURUSD",
  direction: "LONG",
  entryPrice: "",
  stopMode: "pips",
  stopValue: "20",
  stopPrice: "",
  takeProfitPrice: "",
  riskMode: "percent",
  riskValue: "1",
  accountBalance: "10000",
};

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────
export function CalculatorClient() {
  const [state, setState] = React.useState<FormState>(INITIAL_STATE);
  const [result, setResult] = React.useState<PositionResult | null>(null);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  // Live price fetch
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
      setState((s) => ({ ...s, entryPrice: formatted }));
      toast.success(`Latest ${state.symbol} = ${formatted}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Error"),
  });

  // Calculate
  const calculate = useMutation({
    mutationFn: async () => {
      const body =
        state.market === "FOREX"
          ? {
              market: "FOREX",
              accountCurrency: state.accountCurrency,
              symbol: state.symbol,
              direction: state.direction,
              entryPrice: Number(state.entryPrice),
              stopMode: state.stopMode,
              stopValue: Number(state.stopValue),
              takeProfitPrice: state.takeProfitPrice
                ? Number(state.takeProfitPrice)
                : undefined,
              riskMode: state.riskMode,
              riskValue: Number(state.riskValue),
              accountBalance: state.accountBalance
                ? Number(state.accountBalance)
                : undefined,
            }
          : {
              market: "CRYPTO",
              accountCurrency: state.accountCurrency,
              symbol: state.symbol,
              direction: state.direction,
              entryPrice: Number(state.entryPrice),
              stopPrice: Number(state.stopPrice),
              takeProfitPrice: state.takeProfitPrice
                ? Number(state.takeProfitPrice)
                : undefined,
              riskMode: state.riskMode,
              riskValue: Number(state.riskValue),
              accountBalance: state.accountBalance
                ? Number(state.accountBalance)
                : undefined,
            };

      const res = await fetch("/api/calc/position-size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to calculate");
      return data as PositionResult;
    },
    onSuccess: setResult,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Error"),
  });

  // ──────────────────────────────────────────────────────────────────
  // Tab switch resets symbol default
  // ──────────────────────────────────────────────────────────────────
  const onMarketChange = (m: string) => {
    const market = m as "FOREX" | "CRYPTO";
    setState((s) => ({
      ...s,
      market,
      symbol: market === "FOREX" ? "EURUSD" : "BTCUSDT",
      stopMode: market === "FOREX" ? "pips" : s.stopMode,
      entryPrice: "",
      stopValue: market === "FOREX" ? "20" : s.stopValue,
      stopPrice: "",
      takeProfitPrice: "",
    }));
    setResult(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ─── Form ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="size-4 text-primary" />
            Inputs
          </CardTitle>
          <CardDescription>
            Enter your trade parameters. The live price button fills entry from
            the market.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <Tabs value={state.market} onValueChange={onMarketChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="FOREX">Forex</TabsTrigger>
              <TabsTrigger value="CRYPTO">Crypto</TabsTrigger>
            </TabsList>

            <TabsContent value="FOREX" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Account currency">
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
                </FieldGroup>

                <FieldGroup label="Pair">
                  <InstrumentCombobox
                    market="FOREX"
                    value={state.symbol}
                    onChange={(v) => update("symbol", v)}
                  />
                </FieldGroup>
              </div>

              <DirectionToggle
                value={state.direction}
                onChange={(v) => update("direction", v)}
              />

              <EntryPriceField
                state={state}
                update={update}
                onFetch={() => fetchPrice.mutate()}
                fetching={fetchPrice.isPending}
              />

              <FieldGroup
                label="Stop loss"
                hint="Distance from entry, or absolute price."
              >
                <Tabs
                  value={state.stopMode}
                  onValueChange={(v) => update("stopMode", v as StopMode)}
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="pips">Pips</TabsTrigger>
                    <TabsTrigger value="price">Price</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Input
                  inputMode="decimal"
                  className="num mt-2"
                  value={state.stopValue}
                  onChange={(e) => update("stopValue", e.target.value)}
                  placeholder={
                    state.stopMode === "pips" ? "e.g. 20" : "e.g. 1.0820"
                  }
                />
              </FieldGroup>

              <TakeProfitField state={state} update={update} />

              <RiskFields state={state} update={update} />
            </TabsContent>

            <TabsContent value="CRYPTO" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Account currency">
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
                </FieldGroup>

                <FieldGroup label="Symbol">
                  <InstrumentCombobox
                    market="CRYPTO"
                    value={state.symbol}
                    onChange={(v) => update("symbol", v)}
                  />
                </FieldGroup>
              </div>

              <DirectionToggle
                value={state.direction}
                onChange={(v) => update("direction", v)}
              />

              <EntryPriceField
                state={state}
                update={update}
                onFetch={() => fetchPrice.mutate()}
                fetching={fetchPrice.isPending}
              />

              <FieldGroup label="Stop loss price">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.stopPrice}
                  onChange={(e) => update("stopPrice", e.target.value)}
                  placeholder="e.g. 65000"
                />
              </FieldGroup>

              <TakeProfitField state={state} update={update} />
              <RiskFields state={state} update={update} />
            </TabsContent>
          </Tabs>

          <Button
            type="button"
            className="w-full"
            disabled={calculate.isPending}
            onClick={() => calculate.mutate()}
          >
            {calculate.isPending ? "Calculating…" : "Calculate"}
          </Button>
        </CardContent>
      </Card>

      {/* ─── Result ─────────────────────────────────────── */}
      <ResultPanel state={state} result={result} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-baseline justify-between">
        <span>{label}</span>
        {hint ? (
          <span className="text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </Label>
      {children}
    </div>
  );
}

function DirectionToggle({
  value,
  onChange,
}: {
  value: Direction;
  onChange: (v: Direction) => void;
}) {
  return (
    <FieldGroup label="Direction">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={value === "LONG" ? "default" : "outline"}
          className={cn(
            value === "LONG" &&
              "bg-bullish text-bullish-foreground hover:bg-bullish/90",
          )}
          onClick={() => onChange("LONG")}
        >
          <ArrowUpRight className="mr-1 size-4" />
          Long
        </Button>
        <Button
          type="button"
          variant={value === "SHORT" ? "default" : "outline"}
          className={cn(
            value === "SHORT" &&
              "bg-bearish text-bearish-foreground hover:bg-bearish/90",
          )}
          onClick={() => onChange("SHORT")}
        >
          <ArrowDownRight className="mr-1 size-4" />
          Short
        </Button>
      </div>
    </FieldGroup>
  );
}

function EntryPriceField({
  state,
  update,
  onFetch,
  fetching,
}: {
  state: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  onFetch: () => void;
  fetching: boolean;
}) {
  return (
    <FieldGroup label="Entry price">
      <div className="flex gap-2">
        <Input
          inputMode="decimal"
          className="num"
          value={state.entryPrice}
          onChange={(e) => update("entryPrice", e.target.value)}
          placeholder="0.0000"
        />
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={onFetch}
          disabled={fetching || !state.symbol}
        >
          <RefreshCw
            className={cn("mr-1 size-4", fetching && "animate-spin")}
          />
          Live
        </Button>
      </div>
    </FieldGroup>
  );
}

function TakeProfitField({
  state,
  update,
}: {
  state: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <FieldGroup label="Take profit price (optional)">
      <Input
        inputMode="decimal"
        className="num"
        value={state.takeProfitPrice}
        onChange={(e) => update("takeProfitPrice", e.target.value)}
        placeholder="—"
      />
    </FieldGroup>
  );
}

function RiskFields({
  state,
  update,
}: {
  state: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <>
      <FieldGroup label="Risk">
        <Tabs
          value={state.riskMode}
          onValueChange={(v) => update("riskMode", v as RiskMode)}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="percent">% of account</TabsTrigger>
            <TabsTrigger value="fixed">Fixed amount</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input
            inputMode="decimal"
            className="num"
            value={state.riskValue}
            onChange={(e) => update("riskValue", e.target.value)}
            placeholder={state.riskMode === "percent" ? "1.0" : "50"}
          />
          {state.riskMode === "percent" ? (
            <Input
              inputMode="decimal"
              className="num"
              value={state.accountBalance}
              onChange={(e) => update("accountBalance", e.target.value)}
              placeholder="Account balance"
            />
          ) : (
            <div className="flex items-center justify-center rounded-md border bg-muted/30 px-3 text-xs text-muted-foreground">
              {state.accountCurrency}
            </div>
          )}
        </div>
      </FieldGroup>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Result panel
// ──────────────────────────────────────────────────────────────────────

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
          <CardTitle className="text-base">Result</CardTitle>
          <CardDescription>
            Fill in the form and click <strong>Calculate</strong> to see the
            recommended position size.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid h-72 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
            No calculation yet
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
          <CardTitle className="text-base">Result</CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "font-mono",
              state.direction === "LONG"
                ? "border-bullish/40 text-bullish"
                : "border-bearish/40 text-bearish",
            )}
          >
            {state.direction} · {result.meta.display}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Risk */}
        <Row
          label="Risk"
          value={`${ccy} ${fmt(result.riskAmount)}`}
          accent="bearish"
        />

        <Separator />

        {/* Position size block */}
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Position size
          </div>
          {result.market === "FOREX" ? (
            <div className="space-y-1.5">
              <Row
                label="Standard lots"
                value={fmt(result.positionSize.standardLots ?? 0, 4)}
                emphasis
              />
              <Row
                label="Mini lots"
                value={fmt(result.positionSize.miniLots ?? 0, 3)}
              />
              <Row
                label="Micro lots"
                value={fmt(result.positionSize.microLots ?? 0, 2)}
              />
              <Row
                label="Units"
                value={fmt(result.positionSize.units ?? 0, 0)}
              />
            </div>
          ) : (
            <Row
              label={`Units (${result.meta.display.split(" / ")[0]})`}
              value={fmt(result.positionSize.units, 8)}
              emphasis
            />
          )}
        </div>

        <Separator />

        {/* Stop / pip detail */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Stop loss
          </div>
          {result.stopLossPips != null ? (
            <Row
              label="Distance"
              value={`${fmt(result.stopLossPips, 1)} pips`}
            />
          ) : (
            <Row
              label="Distance"
              value={fmt(result.stopLossDistance, 8)}
            />
          )}
          {result.pipValuePerLotInAccount != null ? (
            <Row
              label="Pip value (1 std lot)"
              value={`${ccy} ${fmt(result.pipValuePerLotInAccount, 4)}`}
            />
          ) : null}
        </div>

        <Separator />

        {/* Notional */}
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Notional
          </div>
          <Row
            label={`In ${result.meta.quoteCurrency}`}
            value={fmt(result.notional)}
          />
          <Row
            label={`In ${ccy}`}
            value={fmt(result.notionalInAccount)}
          />
          {result.meta.quoteToAccountRate !== 1 ? (
            <Row
              label={`${result.meta.quoteCurrency}/${ccy} rate`}
              value={fmt(result.meta.quoteToAccountRate, 4)}
            />
          ) : null}
        </div>

        {result.rrRatio != null ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Take profit
              </div>
              {result.takeProfitPips != null ? (
                <Row
                  label="Distance"
                  value={`${fmt(result.takeProfitPips, 1)} pips`}
                />
              ) : null}
              <Row
                label="Reward : Risk"
                value={`${fmt(result.rrRatio, 2)} : 1`}
                emphasis
              />
              {result.expectedProfit != null ? (
                <Row
                  label="Expected profit"
                  value={`${ccy} ${fmt(result.expectedProfit)}`}
                  accent="bullish"
                />
              ) : null}
            </div>
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
  accent,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  accent?: "bullish" | "bearish";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "num text-sm",
          emphasis && "text-base font-semibold",
          accent === "bullish" && "text-bullish",
          accent === "bearish" && "text-bearish",
        )}
      >
        {value}
      </span>
    </div>
  );
}
