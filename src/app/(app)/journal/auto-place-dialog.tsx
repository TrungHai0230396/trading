"use client";

/**
 * Confirm + place dialog for "auto-place on Bitget" from the trade form.
 *
 * Flow when the user submits with the toggle on:
 *   1. Journal save runs first (parent passes the new journal id in).
 *   2. This dialog opens with a server-side spec preview (normalized
 *      size, normalized price, min notional, est. liq price).
 *   3. User types "OK" + clicks Đặt lệnh → POST /api/brokers/bitget/order.
 *   4. Two toasts: one for journal save (already fired), one for broker.
 *      On broker failure the dialog stays open with a Retry button.
 *
 * Defensive defaults: dialog is only mounted from the parent when the
 * toggle is on AND the journal save just succeeded. Cancelling does not
 * roll back the journal save.
 */

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import {
  estimateLiquidationPrice,
  floorToStep,
  roundToStep,
  stepDecimals,
} from "@/lib/brokers/order-math";

export type AutoPlacePayload = {
  tradeJournalId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  units: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage: number;
  marginMode: "isolated" | "crossed";
};

type Spec = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  sizeMultiplier: number;
  priceEndStep: number;
  minTradeNum: number;
  minTradeUSDT: number;
  maintainMarginRate: number;
  symbolStatus: string;
};

type Balance = {
  available: number;
  equity: number;
  used: number;
};

const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toFixed(d) : "—";

export function AutoPlaceDialog({
  open,
  onOpenChange,
  payload,
  onPlaced,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payload: AutoPlacePayload | null;
  onPlaced?: () => void;
}) {
  const [confirmText, setConfirmText] = React.useState("");
  const [spec, setSpec] = React.useState<Spec | null>(null);
  const [specError, setSpecError] = React.useState<string | null>(null);
  const [balance, setBalance] = React.useState<Balance | null>(null);
  const [balanceError, setBalanceError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [placedOrderId, setPlacedOrderId] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);

  // Fetch spec + balance when the dialog opens.
  React.useEffect(() => {
    if (!open || !payload) {
      setConfirmText("");
      setSpec(null);
      setSpecError(null);
      setBalance(null);
      setBalanceError(null);
      setPlacedOrderId(null);
      setWarning(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(
        `/api/brokers/bitget/contract?symbol=${encodeURIComponent(payload.symbol)}`,
      ).then(async (r) => {
        const j = await r.json().catch(() => null);
        return { ok: r.ok, status: r.status, body: j };
      }),
      fetch("/api/brokers/bitget/account").then(async (r) => {
        const j = await r.json().catch(() => null);
        return { ok: r.ok, status: r.status, body: j };
      }),
    ])
      .then(([sp, ba]) => {
        if (cancelled) return;
        if (sp.ok && sp.body?.spec) {
          setSpec(sp.body.spec);
        } else {
          setSpecError(sp.body?.error ?? "Không tra được thông tin hợp đồng.");
        }
        if (ba.ok && ba.body?.balance) {
          setBalance(ba.body.balance);
        } else {
          setBalanceError(ba.body?.error ?? "Không lấy được số dư.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, payload]);

  const place = useMutation({
    mutationFn: async () => {
      if (!payload) throw new Error("Thiếu dữ liệu.");
      const res = await fetch("/api/brokers/bitget/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradeJournalId: payload.tradeJournalId,
          symbol: payload.symbol,
          direction: payload.direction,
          units: payload.units,
          entryPrice: payload.entryPrice,
          orderType: "limit",
          stopLoss: payload.stopLoss,
          takeProfit: payload.takeProfit,
          leverage: payload.leverage,
          marginMode: payload.marginMode,
          confirmText: confirmText.trim().toUpperCase(),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        throw new Error(json?.error?.message ?? "Đặt lệnh thất bại.");
      }
      return json.data as {
        orderId: string;
        status: string;
        warning?: string | null;
      };
    },
    onSuccess: (data) => {
      setPlacedOrderId(data.orderId);
      setWarning(data.warning ?? null);
      if (data.warning) {
        toast.error(data.warning, { duration: 10_000 });
      } else {
        toast.success(`Đã đặt lệnh Bitget · #${data.orderId}`);
      }
      onPlaced?.();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Đặt lệnh thất bại.");
    },
  });

  if (!payload) return null;

  // Pre-flight math, mirrors server-side normalization.
  const normalizedSize = spec
    ? floorToStep(payload.units, spec.sizeMultiplier)
    : payload.units;
  const normalizedPrice = spec
    ? roundToStep(payload.entryPrice, spec.priceEndStep)
    : payload.entryPrice;
  const normalizedSL = spec && payload.stopLoss !== undefined
    ? roundToStep(payload.stopLoss, spec.priceEndStep)
    : payload.stopLoss;
  const normalizedTP = spec && payload.takeProfit !== undefined
    ? roundToStep(payload.takeProfit, spec.priceEndStep)
    : payload.takeProfit;

  const notional = normalizedSize * normalizedPrice;
  const margin = payload.leverage > 0 ? notional / payload.leverage : 0;
  const risk =
    normalizedSL !== undefined
      ? Math.abs(normalizedPrice - normalizedSL) * normalizedSize
      : null;

  const liq = spec
    ? estimateLiquidationPrice({
        side: payload.direction === "LONG" ? "long" : "short",
        entry: normalizedPrice,
        leverage: payload.leverage,
        maintainMarginRate: spec.maintainMarginRate,
        marginMode: payload.marginMode,
      })
    : null;

  const priceDec = spec ? stepDecimals(spec.priceEndStep) : 4;
  const sizeDec = spec ? stepDecimals(spec.sizeMultiplier) : 4;

  const belowMin = spec ? normalizedSize < spec.minTradeNum : false;
  const belowNotional = spec ? notional < spec.minTradeUSDT : false;
  const insufficient = balance ? margin > balance.available * 0.95 : false;
  const slBeyondLiq =
    liq !== null && normalizedSL !== undefined
      ? payload.direction === "LONG"
        ? normalizedSL < liq
        : normalizedSL > liq
      : false;

  const blocking =
    !!specError ||
    !spec ||
    belowMin ||
    belowNotional ||
    insufficient ||
    slBeyondLiq;
  const canSubmit =
    !blocking && confirmText.trim().toUpperCase() === "OK" && !place.isPending;

  const Row = ({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">
        {v}
        {hint ? (
          <span className="ml-1 text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-500" />
            Đặt lệnh thật trên Bitget
          </DialogTitle>
          <DialogDescription>
            Đây là lệnh thật, dùng tiền thật và <strong>không thể hoàn tác</strong>{" "}
            sau khi Bitget khớp lệnh.
          </DialogDescription>
        </DialogHeader>

        {placedOrderId ? (
          <div className="space-y-3 rounded-md border bg-card/40 p-3 text-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-500" />
              <span>
                Đã gửi lệnh tới Bitget · OrderId{" "}
                <code className="font-mono text-xs">{placedOrderId}</code>
              </span>
            </div>
            {warning ? (
              <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mr-1 inline size-3.5" />
                {warning}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Lệnh */}
            <div className="rounded-md border bg-card/40 p-3">
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Lệnh
              </div>
              <Row
                k="Cặp"
                v={
                  <>
                    <span className="font-mono">{payload.symbol}</span>{" "}
                    {spec ? (
                      <Badge variant="outline" className="ml-1 text-[10px]">
                        {spec.baseCoin}/{spec.quoteCoin}
                      </Badge>
                    ) : null}
                  </>
                }
              />
              <Row
                k="Hướng"
                v={
                  <Badge
                    variant={payload.direction === "LONG" ? "default" : "destructive"}
                  >
                    {payload.direction}
                  </Badge>
                }
              />
              <Row
                k="Khối lượng"
                v={
                  <>
                    {fmt(normalizedSize, sizeDec)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {spec?.baseCoin ?? ""}
                    </span>
                  </>
                }
                hint={
                  normalizedSize !== payload.units
                    ? `(làm tròn từ ${payload.units})`
                    : undefined
                }
              />
              <Row
                k="Đòn bẩy"
                v={
                  <>
                    {payload.leverage}x ·{" "}
                    <span className="text-xs text-muted-foreground">
                      {payload.marginMode === "isolated" ? "Cách ly" : "Chéo"}
                    </span>
                  </>
                }
              />
            </div>

            <Separator className="my-2" />

            {/* Giá */}
            <div className="rounded-md border bg-card/40 p-3">
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Giá (USDT)
              </div>
              <Row k="Giá vào" v={fmt(normalizedPrice, priceDec)} />
              {normalizedSL !== undefined ? (
                <Row k="Stop Loss" v={fmt(normalizedSL, priceDec)} />
              ) : null}
              {normalizedTP !== undefined ? (
                <Row k="Take Profit" v={fmt(normalizedTP, priceDec)} />
              ) : null}
              {liq !== null ? (
                <Row
                  k="Giá thanh lý ước tính"
                  v={
                    <span
                      className={
                        slBeyondLiq ? "text-rose-500" : "text-amber-600"
                      }
                    >
                      ~{fmt(liq, priceDec)}
                    </span>
                  }
                />
              ) : null}
            </div>

            <Separator className="my-2" />

            {/* Vốn */}
            <div className="rounded-md border bg-card/40 p-3">
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Vốn
              </div>
              <Row
                k="Giá trị lệnh (notional)"
                v={`${fmt(notional, 2)} USDT`}
              />
              <Row k="Ký quỹ" v={`${fmt(margin, 2)} USDT`} />
              {risk !== null ? (
                <Row k="Rủi ro tới SL" v={`${fmt(risk, 2)} USDT`} />
              ) : null}
              {balance ? (
                <Row
                  k="Khả dụng / Sau lệnh"
                  v={
                    <span
                      className={insufficient ? "text-rose-500" : undefined}
                    >
                      {fmt(balance.available, 2)} → {fmt(balance.available - margin, 2)} USDT
                    </span>
                  }
                />
              ) : balanceError ? (
                <Row
                  k="Số dư"
                  v={<span className="text-rose-500">{balanceError}</span>}
                />
              ) : (
                <Row k="Số dư" v={loading ? "Đang tải…" : "—"} />
              )}
            </div>

            {/* Blocking messages */}
            <div className="space-y-1.5">
              {specError ? (
                <Banner level="error" text={specError} />
              ) : null}
              {belowMin && spec ? (
                <Banner
                  level="error"
                  text={`Khối lượng dưới mức tối thiểu ${spec.minTradeNum} ${spec.baseCoin}.`}
                />
              ) : null}
              {belowNotional && spec ? (
                <Banner
                  level="error"
                  text={`Giá trị lệnh < ${spec.minTradeUSDT} USDT (mức tối thiểu của Bitget).`}
                />
              ) : null}
              {insufficient ? (
                <Banner
                  level="error"
                  text="Ký quỹ vượt 95% số dư khả dụng. Giảm khối lượng hoặc đòn bẩy."
                />
              ) : null}
              {slBeyondLiq ? (
                <Banner
                  level="error"
                  text="Stop Loss nằm xa hơn giá thanh lý ước tính — vị thế sẽ bị thanh lý trước khi SL chạm. Hạ đòn bẩy hoặc đưa SL gần hơn."
                />
              ) : null}
              {normalizedSL === undefined ? (
                <Banner
                  level="warning"
                  text="Lệnh KHÔNG có Stop Loss. Cân nhắc rủi ro."
                />
              ) : null}
            </div>

            <Separator className="my-2" />

            <div className="space-y-1.5">
              <Label htmlFor="confirm-ok">
                Gõ <code className="rounded bg-muted px-1 font-mono">OK</code> để
                xác nhận đặt lệnh thật
              </Label>
              <Input
                id="confirm-ok"
                autoFocus
                placeholder="OK"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={place.isPending || blocking}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          {placedOrderId ? (
            <Button onClick={() => onOpenChange(false)}>Đóng</Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={place.isPending}
              >
                Huỷ (giữ nhật ký)
              </Button>
              <Button
                disabled={!canSubmit}
                onClick={() => place.mutate()}
              >
                {place.isPending ? "Đang đặt…" : "Đặt lệnh"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Banner({
  level,
  text,
}: {
  level: "error" | "warning";
  text: string;
}) {
  const cls =
    level === "error"
      ? "border-rose-400/40 bg-rose-400/10 text-rose-700 dark:text-rose-300"
      : "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300";
  return (
    <div className={`flex gap-2 rounded-md border p-2 text-xs ${cls}`}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
