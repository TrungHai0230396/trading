"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Check, BookOpen, Calculator, Bell, BellRing, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { planToText, type TradePlan } from "@/lib/analysis/trade-plan";

export function ActionBar({
  verdict,
  tradePlan,
  symbol,
  base,
  market,
  accountBalance,
  initialInWatchlist,
}: {
  verdict: "ENTER_LONG" | "ENTER_SHORT" | "WAIT";
  tradePlan: TradePlan | null;
  symbol: string;
  base: string;
  market: "CRYPTO" | "FOREX";
  accountBalance: number;
  initialInWatchlist: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const [watched, setWatched] = React.useState(initialInWatchlist);
  const [watchBusy, setWatchBusy] = React.useState(false);
  const isWait = verdict === "WAIT" || !tradePlan;

  const follow = React.useCallback(async () => {
    setWatchBusy(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, market: "CRYPTO" }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(d?.error ?? `Lỗi ${res.status}`);
        return;
      }
      setWatched(true);
      toast.success(
        `Đang theo dõi ${symbol} — Telegram sẽ báo khi đạt/gãy đồng thuận.`,
      );
    } catch {
      toast.error("Không gửi được yêu cầu — kiểm tra mạng.");
    } finally {
      setWatchBusy(false);
    }
  }, [symbol]);

  const copyText = React.useCallback(() => {
    if (!tradePlan) return;
    const txt = planToText(tradePlan, symbol, base);
    navigator.clipboard.writeText(txt).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // ignore clipboard failures silently — uncommon and harmless
      },
    );
  }, [tradePlan, symbol, base]);

  // Build prefill URLs for the linked tools. These use the EXACT field
  // names the receiving forms parse (see calculator-client / trade-form-
  // client for the parser). Don't invent fields.
  const calcHref = tradePlan
    ? buildCalcHref({
        market,
        symbol,
        entryPrice: tradePlan.entryPrice,
        stopPrice: tradePlan.slPrice,
        riskAmount: tradePlan.riskAmount,
      })
    : `/calculator?market=${market}&symbol=${encodeURIComponent(symbol)}`;

  const journalHref = tradePlan
    ? buildJournalHref({
        market,
        symbol,
        direction: tradePlan.direction,
        entryPrice: tradePlan.entryPrice,
        stopLoss: tradePlan.slPrice,
        takeProfit: tradePlan.tp2Price,
        riskAmount: tradePlan.riskAmount,
        setup: `AI ${verdict === "ENTER_LONG" ? "LONG" : "SHORT"} · ATR ${tradePlan.atrMultiple.toFixed(2)}× · RR 1:2 · margin ${tradePlan.margin} USDT @${tradePlan.leverageRequired}x · ví ${accountBalance} USDT`,
      })
    : `/journal/new?market=${market}&symbol=${encodeURIComponent(symbol)}`;

  return (
    <div
      className={cn(
        // MOBILE: sticky-to-bottom, full-bleed via -mx-4 so the border
        // extends edge-to-edge under the page padding.
        "sticky bottom-0 left-0 right-0 z-30 -mx-4 mt-4 border-t bg-background/95 px-4 py-3 backdrop-blur",
        // DESKTOP: undo the negative margin AND the background — the
        // bar is just an inline row of buttons at the end of the page.
        "md:static md:mx-0 md:mt-0 md:border-0 md:bg-transparent md:px-0 md:py-2",
      )}
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 0.75rem)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Terminal action first — it was buried in the last slot while
            "copy" (the least consequential button) held prime position. */}
        <Button
          size="sm"
          className="flex-1 md:flex-none"
          render={<Link href={journalHref} />}
        >
          <BookOpen className="size-4" />
          Tạo lệnh
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 md:flex-none"
          render={<Link href={calcHref} />}
        >
          <Calculator className="size-4" />
          Tính lot
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 md:flex-none"
          onClick={follow}
          disabled={watched || watchBusy}
          title={
            watched
              ? "Đã theo dõi — chỉnh khung riêng trong panel Watchlist ở trang Quét"
              : "Thêm vào watchlist — Telegram báo khi đạt/gãy đồng thuận"
          }
        >
          {watchBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : watched ? (
            <BellRing className="size-4 text-primary" />
          ) : (
            <Bell className="size-4" />
          )}
          {watched ? "Đang theo dõi" : "Theo dõi"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 md:flex-none"
          onClick={copyText}
          disabled={isWait}
          title={isWait ? "Chưa có kế hoạch để copy" : "Sao chép kế hoạch"}
        >
          {copied ? (
            <Check className="size-4 text-bullish" />
          ) : (
            <Copy className="size-4" />
          )}
          {copied ? "Đã copy" : "Sao chép"}
        </Button>
      </div>
    </div>
  );
}

// ── URL builders — keep field names in sync with receiving forms ────

function buildCalcHref(opts: {
  market: "CRYPTO" | "FOREX";
  symbol: string;
  entryPrice: number;
  stopPrice: number;
  riskAmount: number;
}): string {
  const u = new URLSearchParams();
  u.set("market", opts.market);
  u.set("symbol", opts.symbol);
  u.set("entryPrice", String(opts.entryPrice));
  u.set("stopPrice", String(opts.stopPrice));
  u.set("stopMode", "price");
  u.set("riskAmount", String(opts.riskAmount));
  return `/calculator?${u.toString()}`;
}

function buildJournalHref(opts: {
  market: "CRYPTO" | "FOREX";
  symbol: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  setup: string;
}): string {
  const u = new URLSearchParams();
  u.set("market", opts.market);
  u.set("symbol", opts.symbol);
  u.set("direction", opts.direction);
  u.set("entryPrice", String(opts.entryPrice));
  u.set("stopLoss", String(opts.stopLoss));
  u.set("takeProfit", String(opts.takeProfit));
  u.set("riskAmount", String(opts.riskAmount));
  // Cap setup at 280 chars to keep URL reasonable on mobile clients.
  u.set("setup", opts.setup.slice(0, 280));
  return `/journal/new?${u.toString()}`;
}
