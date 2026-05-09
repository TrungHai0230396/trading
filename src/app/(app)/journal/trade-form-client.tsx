"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Save, Trash2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TradeDetail } from "@/lib/journal/types";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────
type Mode = "new" | "edit";

type FormState = {
  symbol: string;
  market: "FOREX" | "CRYPTO" | "STOCK" | "COMMODITY" | "INDEX" | "OTHER";
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED" | "CANCELED";
  timeframe: string;
  entryPrice: string;
  exitPrice: string;
  stopLoss: string;
  takeProfit: string;
  lotSize: string;
  riskAmount: string;
  pnl: string;
  feesAmount: string;
  openedAt: string;
  closedAt: string;
  setup: string;
  notes: string;
  mistakes: string;
  emotion: string;
  tagNames: string;
};

const num = (s: string): number => Number(String(s).replace(",", "."));
const empty = (s: string) => s.trim() === "";

function nowLocalIso(): string {
  // input[type=datetime-local] format: YYYY-MM-DDTHH:mm
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

const INITIAL: FormState = {
  symbol: "",
  market: "FOREX",
  direction: "LONG",
  status: "OPEN",
  timeframe: "",
  entryPrice: "",
  exitPrice: "",
  stopLoss: "",
  takeProfit: "",
  lotSize: "",
  riskAmount: "0",
  pnl: "",
  feesAmount: "",
  openedAt: nowLocalIso(),
  closedAt: "",
  setup: "",
  notes: "",
  mistakes: "",
  emotion: "",
  tagNames: "",
};

function fromTrade(t: TradeDetail): FormState {
  return {
    symbol: t.symbol,
    market: t.market as FormState["market"],
    direction: t.direction as FormState["direction"],
    status: t.status as FormState["status"],
    timeframe: t.timeframe ?? "",
    entryPrice: t.entryPrice !== null ? String(t.entryPrice) : "",
    exitPrice: t.exitPrice !== null ? String(t.exitPrice) : "",
    stopLoss: t.stopLoss !== null ? String(t.stopLoss) : "",
    takeProfit: t.takeProfit !== null ? String(t.takeProfit) : "",
    lotSize: t.lotSize !== null ? String(t.lotSize) : "",
    riskAmount: t.riskAmount !== null ? String(t.riskAmount) : "0",
    pnl: t.pnl !== null ? String(t.pnl) : "",
    feesAmount: t.feesAmount !== null ? String(t.feesAmount) : "",
    openedAt: isoToLocal(t.openedAt),
    closedAt: isoToLocal(t.closedAt),
    setup: t.setup ?? "",
    notes: t.notes ?? "",
    mistakes: t.mistakes ?? "",
    emotion: t.emotion ?? "",
    tagNames: t.tags.map((tg) => tg.name).join(", "),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────
export function TradeFormClient({
  mode,
  trade,
}: {
  mode: Mode;
  trade?: TradeDetail;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<FormState>(() =>
    trade ? fromTrade(trade) : INITIAL,
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const submit = useMutation({
    mutationFn: async () => {
      const tagNames = state.tagNames
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const payload: Record<string, unknown> = {
        symbol: state.symbol.trim(),
        market: state.market,
        direction: state.direction,
        status: state.status,
        timeframe: empty(state.timeframe) ? undefined : state.timeframe.trim(),
        entryPrice: num(state.entryPrice),
        lotSize: num(state.lotSize),
        riskAmount: empty(state.riskAmount) ? 0 : num(state.riskAmount),
        openedAt: localToIso(state.openedAt),
        ...(empty(state.exitPrice)
          ? {}
          : { exitPrice: num(state.exitPrice) }),
        ...(empty(state.stopLoss) ? {} : { stopLoss: num(state.stopLoss) }),
        ...(empty(state.takeProfit)
          ? {}
          : { takeProfit: num(state.takeProfit) }),
        ...(empty(state.pnl) ? {} : { pnl: num(state.pnl) }),
        ...(empty(state.feesAmount)
          ? {}
          : { feesAmount: num(state.feesAmount) }),
        ...(empty(state.closedAt)
          ? {}
          : { closedAt: localToIso(state.closedAt) }),
        ...(empty(state.setup) ? {} : { setup: state.setup.trim() }),
        ...(empty(state.notes) ? {} : { notes: state.notes.trim() }),
        ...(empty(state.mistakes) ? {} : { mistakes: state.mistakes.trim() }),
        ...(empty(state.emotion) ? {} : { emotion: state.emotion.trim() }),
        ...(tagNames.length > 0 ? { tagNames } : {}),
      };

      const url =
        mode === "new" ? "/api/journal" : `/api/journal/${trade?.id}`;
      const method = mode === "new" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Lưu thất bại");
      return data as { id: string };
    },
    onSuccess: (data) => {
      toast.success(mode === "new" ? "Đã tạo lệnh" : "Đã cập nhật");
      queryClient.invalidateQueries({ queryKey: ["journal"] });
      if (mode === "new") {
        router.push(`/journal/${data.id}`);
      } else {
        router.refresh();
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Lỗi");
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!trade) return;
      const res = await fetch(`/api/journal/${trade.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Xoá thất bại");
      return data;
    },
    onSuccess: () => {
      toast.success("Đã xoá lệnh");
      queryClient.invalidateQueries({ queryKey: ["journal"] });
      router.push("/journal");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Lỗi");
    },
  });

  const validForm =
    !empty(state.symbol) &&
    !empty(state.entryPrice) &&
    !empty(state.lotSize) &&
    !empty(state.openedAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/journal" />}
        >
          <ArrowLeft className="size-4" />
          Quay lại
        </Button>
        {mode === "edit" && trade ? (
          <DeleteButton
            onConfirm={() => remove.mutate()}
            disabled={remove.isPending}
          />
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ─── Left column: core fields ─────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin lệnh</CardTitle>
            <CardDescription>
              Symbol, hướng, khối lượng và giá vào/ra.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Symbol *">
                <Input
                  className="num"
                  value={state.symbol}
                  onChange={(e) =>
                    update("symbol", e.target.value.toUpperCase())
                  }
                  placeholder="EURUSD, BTCUSDT…"
                />
              </Field>
              <Field label="Thị trường">
                <Select
                  value={state.market}
                  onValueChange={(v) =>
                    v && update("market", v as FormState["market"])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FOREX">Forex</SelectItem>
                    <SelectItem value="CRYPTO">Crypto</SelectItem>
                    <SelectItem value="STOCK">Stock</SelectItem>
                    <SelectItem value="COMMODITY">Commodity</SelectItem>
                    <SelectItem value="INDEX">Index</SelectItem>
                    <SelectItem value="OTHER">Khác</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Hướng">
                <Select
                  value={state.direction}
                  onValueChange={(v) =>
                    v && update("direction", v as FormState["direction"])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LONG">LONG</SelectItem>
                    <SelectItem value="SHORT">SHORT</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Trạng thái">
                <Select
                  value={state.status}
                  onValueChange={(v) =>
                    v && update("status", v as FormState["status"])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Đang mở</SelectItem>
                    <SelectItem value="CLOSED">Đã đóng</SelectItem>
                    <SelectItem value="CANCELED">Đã hủy</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Lot / units *">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.lotSize}
                  onChange={(e) => update("lotSize", e.target.value)}
                  placeholder={state.market === "FOREX" ? "0.10" : "0.05"}
                />
              </Field>
              <Field label="Timeframe">
                <Input
                  value={state.timeframe}
                  onChange={(e) => update("timeframe", e.target.value)}
                  placeholder="1h, 4h, 1d…"
                />
              </Field>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Giá vào *">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.entryPrice}
                  onChange={(e) => update("entryPrice", e.target.value)}
                  placeholder="1.0850"
                />
              </Field>
              <Field label="Giá ra">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.exitPrice}
                  onChange={(e) => update("exitPrice", e.target.value)}
                  placeholder="—"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Stop loss">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.stopLoss}
                  onChange={(e) => update("stopLoss", e.target.value)}
                  placeholder="—"
                />
              </Field>
              <Field label="Take profit">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.takeProfit}
                  onChange={(e) => update("takeProfit", e.target.value)}
                  placeholder="—"
                />
              </Field>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Số tiền risk">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.riskAmount}
                  onChange={(e) => update("riskAmount", e.target.value)}
                  placeholder="50"
                />
              </Field>
              <Field label="Phí (fees)">
                <Input
                  inputMode="decimal"
                  className="num"
                  value={state.feesAmount}
                  onChange={(e) => update("feesAmount", e.target.value)}
                  placeholder="—"
                />
              </Field>
            </div>

            <Field label="P/L (override)" hint="Để trống để tự tính khi đóng lệnh.">
              <Input
                inputMode="decimal"
                className="num"
                value={state.pnl}
                onChange={(e) => update("pnl", e.target.value)}
                placeholder="—"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Mở lúc *">
                <Input
                  type="datetime-local"
                  className="num"
                  value={state.openedAt}
                  onChange={(e) => update("openedAt", e.target.value)}
                />
              </Field>
              <Field label="Đóng lúc">
                <Input
                  type="datetime-local"
                  className="num"
                  value={state.closedAt}
                  onChange={(e) => update("closedAt", e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ─── Right column: review/notes ────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ghi chú & review</CardTitle>
            <CardDescription>
              Setup, cảm xúc và sai lầm — viết để rút kinh nghiệm.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Setup">
              <Textarea
                value={state.setup}
                onChange={(e) => update("setup", e.target.value)}
                placeholder="Mô tả setup vào lệnh, cấu hình kỹ thuật…"
                rows={3}
              />
            </Field>
            <Field label="Notes">
              <Textarea
                value={state.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Diễn biến, lý do quản trị lệnh…"
                rows={3}
              />
            </Field>
            <Field label="Mistakes">
              <Textarea
                value={state.mistakes}
                onChange={(e) => update("mistakes", e.target.value)}
                placeholder="Sai lầm đã mắc, bài học rút ra…"
                rows={3}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Cảm xúc">
                <Input
                  value={state.emotion}
                  onChange={(e) => update("emotion", e.target.value)}
                  placeholder="FOMO, kỷ luật, sợ hãi…"
                />
              </Field>
              <Field label="Tags" hint="Phân cách bằng dấu phẩy.">
                <Input
                  value={state.tagNames}
                  onChange={(e) => update("tagNames", e.target.value)}
                  placeholder="breakout, london"
                />
              </Field>
            </div>

            {trade?.tags?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {trade.tags.map((t) => (
                  <Badge key={t.id} variant="secondary">
                    {t.name}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          render={<Link href="/journal" />}
        >
          Hủy
        </Button>
        <Button
          type="button"
          disabled={!validForm || submit.isPending}
          onClick={() => submit.mutate()}
        >
          <Save className="size-4" />
          {submit.isPending
            ? "Đang lưu…"
            : mode === "new"
              ? "Tạo lệnh"
              : "Lưu thay đổi"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DeleteButton({
  onConfirm,
  disabled,
}: {
  onConfirm: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm" disabled={disabled}>
            <Trash2 className="size-4" />
            Xoá lệnh
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xoá lệnh này?</DialogTitle>
          <DialogDescription>
            Hành động này không thể hoàn tác. Toàn bộ ghi chú, tag và screenshot
            đính kèm sẽ bị xoá vĩnh viễn.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Hủy
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
            className={cn(disabled && "pointer-events-none opacity-60")}
          >
            Xoá
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
