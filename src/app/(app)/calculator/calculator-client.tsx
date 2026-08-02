"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, NotebookPen, RefreshCw } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  leverage?: {
    exact: number;
    rounded: number;
    safe: number;
    marginForExact: number;
    marginForSafe: number;
  };
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
  tpPrice: string;          // Take profit price (optional) — for R:R + journal
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
  tpPrice: "",
};

// Allow comma decimals (European style) in number inputs.
const num = (s: string): number => Number(String(s).replace(",", "."));

/** The params this form actually consumes. */
const DEEP_LINK_KEYS = [
  "market",
  "symbol",
  "riskAmount",
  "stopMode",
  "stopPips",
  "entryPrice",
  "stopPrice",
  "takeProfit",
  "takeProfitPrice",
  "accountCurrency",
] as const;

/**
 * Did we arrive via a "Tính lot" deep link (vs. a plain visit)?
 *
 * Checked key-by-key on purpose: `params.size` is unsupported before Safari
 * 17, where it reads `undefined` and would make every URL look like a plain
 * visit — silently letting the saved form overwrite the deep-linked trade.
 * Keying on our own params also means unrelated query strings (utm_*, auth
 * callback leftovers) don't suppress the restore.
 */
function hasDeepLinkParams(params: URLSearchParams | null): boolean {
  if (!params) return false;
  return DEEP_LINK_KEYS.some((k) => params.get(k) !== null);
}

/**
 * Build a state by overlaying URL-search-param values onto `base`. Used when
 * navigating in from the scanner analysis page's "Tính lot" button.
 *
 * Only the params we explicitly handle make it through — anything else
 * is ignored to keep behavior predictable.
 */
function stateFromSearchParams(
  params: URLSearchParams | null,
  base: FormState = INITIAL_STATE,
): FormState {
  if (!params) return base;
  const next: FormState = { ...base };
  const market = params.get("market");
  if (market === "CRYPTO" || market === "FOREX") next.market = market;
  const symbol = params.get("symbol");
  if (symbol) next.symbol = symbol.toUpperCase();
  const riskAmount = params.get("riskAmount");
  if (riskAmount) next.riskAmount = riskAmount;
  const stopMode = params.get("stopMode");
  if (stopMode === "pips" || stopMode === "price") next.stopMode = stopMode;
  const stopPips = params.get("stopPips");
  if (stopPips) next.stopPips = stopPips;
  const entryPrice = params.get("entryPrice");
  if (entryPrice) next.entryPrice = entryPrice;
  const takeProfit = params.get("takeProfit") ?? params.get("takeProfitPrice");
  if (takeProfit) next.tpPrice = takeProfit;
  const stopPrice = params.get("stopPrice");
  if (stopPrice) {
    next.stopPrice = stopPrice;
    // When SL price arrives we want price-mode by default (caller may
    // override with stopMode=pips above).
    if (!stopMode) next.stopMode = "price";
  }
  const accountCurrency = params.get("accountCurrency");
  if (accountCurrency) next.accountCurrency = accountCurrency.toUpperCase();
  return next;
}

// ──────────────────────────────────────────────────────────────────────
// Persistence — remember the user's inputs across reloads
// ──────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "calculator.form.v1";

/**
 * Read the saved form back. Every field is validated against the current
 * shape, so a stale or hand-edited entry degrades to the defaults instead
 * of poisoning the form. Returns null when there's nothing usable.
 */
function loadSavedState(): FormState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Record<keyof FormState, unknown>>;
    if (!saved || typeof saved !== "object") return null;

    const next: FormState = { ...INITIAL_STATE };
    if (saved.market === "FOREX" || saved.market === "CRYPTO")
      next.market = saved.market;
    if (saved.stopMode === "pips" || saved.stopMode === "price")
      next.stopMode = saved.stopMode;
    for (const key of [
      "accountCurrency",
      "symbol",
      "riskAmount",
      "stopPips",
      "entryPrice",
      "stopPrice",
      "tpPrice",
    ] as const) {
      const v = saved[key];
      if (typeof v === "string") next[key] = v;
    }
    return next;
  } catch {
    return null;
  }
}

function saveState(state: FormState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota — persistence is a convenience, never fatal.
  }
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────
export function CalculatorClient() {
  // `useSearchParams` requires a Suspense boundary in Next 16.
  // The parent page (calculator/page.tsx) wraps us in <Suspense>.
  const searchParams = useSearchParams();
  const [state, setState] = React.useState<FormState>(() =>
    stateFromSearchParams(searchParams),
  );
  const [result, setResult] = React.useState<PositionResult | null>(null);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  // Restore the last-used inputs on mount, so a reload doesn't wipe the
  // form. Runs in an effect (not the useState initializer) because
  // localStorage isn't available during SSR — reading it there would
  // desync hydration. A deep-link from the scanner ("Tính lot") carries
  // its own params and always wins over the saved form.
  const [restored, setRestored] = React.useState(false);
  React.useEffect(() => {
    if (restored) return;
    const saved = loadSavedState();
    if (saved) {
      if (hasDeepLinkParams(searchParams)) {
        // The deep link owns the TRADE (symbol, entry, SL, TP) — never carry
        // a previous symbol's prices into it. But it doesn't carry
        // account-level preferences, so inherit those from the saved form
        // rather than resetting the user to USD / the default risk size.
        setState(
          stateFromSearchParams(searchParams, {
            ...INITIAL_STATE,
            accountCurrency: saved.accountCurrency,
            riskAmount: saved.riskAmount,
          }),
        );
      } else {
        setState(saved);
      }
    }
    setRestored(true);
  }, [searchParams, restored]);

  // Persist on every change. Gated on `restored` (state, not a ref) so the
  // very first render can't write the defaults over the saved form before
  // the restore above has been applied.
  React.useEffect(() => {
    if (!restored) return;
    saveState(state);
  }, [state, restored]);

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
              takeProfitPrice: state.tpPrice ? num(state.tpPrice) : undefined,
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
              takeProfitPrice: state.tpPrice ? num(state.tpPrice) : undefined,
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

  // Reload used to be the de-facto "clear the form" gesture; now that inputs
  // persist, give that back explicitly.
  const resetForm = () => {
    setState(INITIAL_STATE);
    setResult(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore — nothing to clear
    }
    toast.success("Đã đặt lại thông số mặc định.");
  };

  /**
   * Switching instrument clears every price-shaped field. Entry / SL / TP are
   * prices of the pair you just left, so keeping them would quietly size a
   * position against the wrong instrument. The pip distance survives (it's a
   * distance, not a price), as do risk and currency.
   */
  const onSymbolChange = (symbol: string) => {
    setState((s) =>
      s.symbol === symbol
        ? s
        : { ...s, symbol, entryPrice: "", stopPrice: "", tpPrice: "" },
    );
    setResult(null);
  };

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
      tpPrice: "",
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
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="size-4 text-primary" />
                Thông số đầu vào
              </CardTitle>
              <CardDescription>
                Nhập số tiền risk và stop loss để tính khối lượng lệnh ra lots
                và units. App tự nhớ thông số bạn nhập cho lần sau.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0"
              onClick={resetForm}
              title="Xoá thông số đã nhớ, về mặc định"
            >
              <RefreshCw className="size-3.5" />
              Đặt lại
            </Button>
          </div>
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
                    onChange={onSymbolChange}
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
                <>
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
                  <Field label="Take profit (giá — tuỳ chọn)">
                    <Input
                      inputMode="decimal"
                      className="num"
                      value={state.tpPrice}
                      onChange={(e) => update("tpPrice", e.target.value)}
                      placeholder="Để trống nếu chưa đặt TP"
                    />
                  </Field>
                </>
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
                    onChange={onSymbolChange}
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

              <Field label="Take profit (giá — tuỳ chọn)">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.tpPrice}
                  onChange={(e) => update("tpPrice", e.target.value)}
                  placeholder="Để trống nếu chưa đặt TP"
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

/**
 * Label + control. The control is rendered INSIDE the <label>, which is what
 * associates the two — screen readers used to announce every money input as
 * unlabelled and tapping the text didn't focus the field. Implicit
 * association (rather than htmlFor + id) because the children here aren't all
 * plain inputs: some are a Select trigger, a combobox, or an input paired with
 * the "Live" button, and the browser just binds to the first labelable
 * descendant in each case.
 *
 * The text sits in a <span> with the <Label> component's own classes — a
 * <label> nested inside a <label> would be invalid markup.
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium leading-none select-none">
        {label}
      </span>
      {children}
    </label>
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
              label="Standard Lots"
              value={fmt(result.positionSize.standardLots ?? 0, 4)}
              emphasis
            />
            <ForexRoundingOptions
              exactLots={result.positionSize.standardLots ?? 0}
              stopLossPips={result.stopLossPips ?? 0}
              pipValuePerLot={result.pipValuePerLotInAccount ?? 0}
              accountCcy={ccy}
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
            {/* Drop Notional in account currency when it would just
                duplicate the quote-currency row (always the case when
                quote ≈ account, e.g. USDT-quoted crypto for a USD
                account). User asked for less duplication. */}
            {Math.abs(result.notional - result.notionalInAccount) > 0.01 ? (
              <Row
                label={`Notional (${ccy})`}
                value={fmt(result.notionalInAccount)}
              />
            ) : null}
            <Row
              label="Khoảng cách Stop Loss"
              value={fmt(result.stopLossDistance, 8)}
            />
          </>
        )}

        {/* Leverage card only relevant for crypto futures. In forex,
            "leverage" is set once at account level by the broker and
            the lot system already encodes the leveraged notional, so
            showing this card just adds confusion. */}
        {result.leverage && result.market === "CRYPTO" ? (
          <>
            <Separator />
            <LeverageCard
              leverage={result.leverage}
              notionalInAccount={result.notionalInAccount}
              riskAmount={result.riskAmount}
              accountCcy={ccy}
            />
          </>
        ) : null}

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

        <Separator />
        <CreateTradeButton state={state} result={result} />
      </CardContent>
    </Card>
  );
}

/**
 * Đòn bẩy futures — crypto only. The headline is the SAFE number: a stop-out
 * there only eats part of the margin, so a wick or a little slippage past SL
 * doesn't liquidate the position. The floored `rounded` value comes second as
 * the aggressive option — its margin barely covers the stop distance, so
 * liquidation sits immediately behind SL.
 *
 * Margins are derived from the notional (margin = notional / leverage) instead
 * of using marginForExact / marginForSafe: those two assume the un-floored
 * leverage and so understate what the exchange actually locks up.
 */
function LeverageCard({
  leverage,
  notionalInAccount,
  riskAmount,
  accountCcy,
}: {
  leverage: NonNullable<PositionResult["leverage"]>;
  notionalInAccount: number;
  riskAmount: number;
  accountCcy: string;
}) {
  const fmt = (n: number, dp = 2) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }).format(n);

  // Exchanges only accept whole-number leverage. Floor for the same reason the
  // calculator does — rounding up pulls liquidation inside the stop.
  const safeLev = Math.max(1, Math.floor(leverage.safe));
  const maxLev = Math.max(1, leverage.rounded);
  const safeMargin = notionalInAccount / safeLev;
  const maxMargin = notionalInAccount / maxLev;
  // What a stop-out really costs at the safe leverage, as a share of margin.
  const safeLossPct =
    safeMargin > 0 ? Math.round((riskAmount / safeMargin) * 100) : null;

  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Đòn bẩy futures gợi ý (an toàn)
        </span>
        <span className="num text-2xl font-semibold leading-none text-primary">
          {safeLev}x
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Đặt <strong>{safeLev}x</strong> với margin ≈{" "}
        <strong>
          {accountCcy} {fmt(safeMargin)}
        </strong>
        {safeLossPct != null
          ? ` → chạm SL mất ~${safeLossPct}% margin, còn đệm trước giá thanh lý.`
          : " → chạm SL chỉ mất một phần margin, còn đệm trước giá thanh lý."}
      </p>
      <Separator />
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">
          Mạo hiểm — mức tối đa
        </span>
        <span className="num text-sm font-medium">
          {maxLev}x · margin ≈ {accountCcy} {fmt(maxMargin)}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Margin chỉ vừa đủ cho quãng SL: giá thanh lý gần như trùng SL. Phí,
        funding hay mark price nhảy một nhịp là bị thanh lý trước khi SL kịp
        khớp. Đừng đặt cao hơn mức này.
      </p>
    </div>
  );
}

/**
 * Deep-link the calculator's result into the journal new-trade form via
 * URL params. The journal form's applyPrefillFromParams() already knows
 * how to read these — see [journal/trade-form-client.tsx].
 *
 * For crypto the lotSize is base-coin units (DOGE, BTC...). For forex it
 * is Standard Lots. Direction is derived from entry vs SL: SL below entry
 * → LONG, SL above entry → SHORT.
 */
function CreateTradeButton({
  state,
  result,
}: {
  state: FormState;
  result: PositionResult;
}) {
  const entry = num(state.entryPrice);
  const stop = num(state.stopPrice);
  const hasPriceMode = Number.isFinite(entry) && Number.isFinite(stop) && entry > 0 && stop > 0;
  const direction: "LONG" | "SHORT" | null = hasPriceMode
    ? stop < entry
      ? "LONG"
      : "SHORT"
    : null;

  // Forex: làm tròn XUỐNG về bước lot 0.01 để size ghi vào nhật ký không vượt
  // quá risk đã tính (0.012 std lot → 0.01, không phải 0.012). Crypto để units
  // lẻ như cũ (không có bước 0.01).
  const isForex = result.market === "FOREX";
  const exactLots = result.positionSize.standardLots ?? 0;
  const lotSize = isForex
    ? Math.floor(exactLots * 100) / 100
    : result.positionSize.units;

  // Brokers trade forex in 0.01-lot steps, so flooring a size below 0.01 lands
  // on 0.00 — not a position anyone can actually open. That is a real answer,
  // not a bug: the risk is too small for this stop distance. Don't silently
  // round up (that would quietly exceed the risk the user asked for); offer
  // the minimum lot as an explicit, priced choice instead.
  const belowMinLot = isForex && exactLots > 0 && lotSize <= 0;
  const MIN_LOT = 0.01;
  const riskPerLot =
    result.stopLossPips != null && result.pipValuePerLotInAccount != null
      ? result.stopLossPips * result.pipValuePerLotInAccount
      : null;
  const minLotRisk = riskPerLot != null ? MIN_LOT * riskPerLot : null;

  // Strip the "BASE / QUOTE" display name down to the broker symbol — for
  // crypto the API returns the raw symbol in meta.symbol; for forex it's
  // the 6-char pair like EURUSD.
  const symbolParam = (result.meta.symbol || state.symbol).toUpperCase();

  const tp = num(state.tpPrice);

  // Carry the suggested leverage for reference in the journal note instead of
  // falling back to the hardcoded default. Use the "safe" (50% buffer) value
  // rather than `rounded` — at `rounded` the liquidation price sits right
  // behind SL, which a mark-price wick can reach first. Always FLOOR: less
  // leverage = more margin = safer.
  const safeLev =
    result.leverage && result.market === "CRYPTO"
      ? Math.max(1, Math.floor(result.leverage.safe))
      : null;

  /**
   * Build the journal deep link for a given size. Parameterised because the
   * below-minimum case offers a second, explicitly-priced option (0.01 lot)
   * alongside the computed one.
   */
  const hrefFor = (lot: number, riskOverride?: number): string => {
    const params = new URLSearchParams();
    params.set("symbol", symbolParam);
    params.set("market", result.market);
    if (direction) params.set("direction", direction);
    if (Number.isFinite(entry) && entry > 0)
      params.set("entryPrice", String(entry));
    if (Number.isFinite(stop) && stop > 0) params.set("stopLoss", String(stop));
    if (Number.isFinite(tp) && tp > 0) params.set("takeProfit", String(tp));
    if (lot > 0) params.set("lotSize", String(lot));
    const risk = riskOverride ?? result.riskAmount;
    if (risk > 0) params.set("riskAmount", String(risk));
    if (safeLev != null) params.set("leverage", String(safeLev));
    if (result.market === "CRYPTO") {
      params.set(
        "setup",
        `Tính từ Calculator: risk ${result.riskAmount}, ${lot} units${result.leverage && safeLev != null ? `, đòn bẩy ${safeLev}x (tối đa ${result.leverage.rounded}x)` : ""}`,
      );
    }
    return `/journal/new?${params.toString()}`;
  };

  const disabled = !hasPriceMode || lotSize <= 0;

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={disabled}
        render={<Link href={hrefFor(lotSize)} aria-disabled={disabled} />}
      >
        <NotebookPen className="size-4" />
        Tạo lệnh trong Nhật ký
      </Button>
      {!hasPriceMode ? (
        <p className="text-[11px] text-muted-foreground">
          Cần điền giá vào + giá Stop loss để dùng nút này.
        </p>
      ) : belowMinLot ? (
        // The real reason, instead of the old catch-all "fill in entry + SL"
        // message that fired here even when both were filled.
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Khối lượng đúng là{" "}
            <strong className="num">{exactLots.toFixed(4)}</strong> lot — nhỏ
            hơn mức tối thiểu <strong>0.01</strong> của sàn, làm tròn xuống
            thành 0.00 nên không vào lệnh được. Hãy{" "}
            <strong>tăng số tiền risk</strong> hoặc <strong>thu hẹp Stop
            loss</strong>.
          </p>
          {minLotRisk != null ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                render={<Link href={hrefFor(MIN_LOT, minLotRisk)} />}
              >
                <NotebookPen className="size-4" />
                Vẫn tạo với 0.01 lot
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Lưu ý: 0.01 lot risk{" "}
                <strong className="num">
                  {state.accountCurrency} {minLotRisk.toFixed(2)}
                </strong>
                , cao hơn mức {state.accountCurrency}{" "}
                {result.riskAmount.toFixed(2)} bạn đặt.
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Mở form Nhật ký với các trường đã điền sẵn ({symbolParam}, {direction},
          {" "}vào {entry}, SL {stop}, {result.market === "CRYPTO" ? `${lotSize} units` : `${lotSize} lots`})
          {" "}để bạn ghi lại. App chỉ-đọc, không đặt lệnh hộ — bạn tự vào lệnh
          trên sàn rồi lưu vào nhật ký.
        </p>
      )}
    </div>
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

// ──────────────────────────────────────────────────────────────────────
// Binance order hint — copy-paste-friendly numbers + which field to use
// ──────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────
// Forex rounding options — brokers accept 0.01 step, so show the two
// nearest valid lot sizes alongside the exact answer, with the real
// dollar risk each one produces. Helps user pick "0.02 = $4" vs
// "0.03 = $6" instead of doing the math themselves.
// ──────────────────────────────────────────────────────────────────────
function ForexRoundingOptions({
  exactLots,
  stopLossPips,
  pipValuePerLot,
  accountCcy,
}: {
  exactLots: number;
  stopLossPips: number;
  pipValuePerLot: number;
  accountCcy: string;
}) {
  const fmt = (n: number, dp = 2) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }).format(n);

  if (
    !Number.isFinite(exactLots) ||
    exactLots <= 0 ||
    !Number.isFinite(stopLossPips) ||
    !Number.isFinite(pipValuePerLot)
  ) {
    return null;
  }

  const floorLots = Math.floor(exactLots * 100) / 100;
  const ceilLots = Math.ceil(exactLots * 100) / 100;

  // If the exact value already lands on a 0.01 multiple, there's nothing
  // to round — skip the section.
  if (floorLots === ceilLots) return null;

  const riskPerLot = stopLossPips * pipValuePerLot;
  const floorRisk = floorLots * riskPerLot;
  const ceilRisk = ceilLots * riskPerLot;

  // Render with the same label-left / value-right format as the
  // "Standard Lots" row above so every lot number sits in the SAME
  // right column. Previously this section had its own layout with the
  // lot number on the left, breaking visual alignment.
  return (
    <>
      <Row
        label="Làm tròn xuống"
        value={`${fmt(floorLots, 2)}  ·  risk ${accountCcy} ${fmt(floorRisk)}`}
      />
      <Row
        label="Làm tròn lên"
        value={`${fmt(ceilLots, 2)}  ·  risk ${accountCcy} ${fmt(ceilRisk)}`}
      />
    </>
  );
}

