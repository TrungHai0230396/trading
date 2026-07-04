"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Save, Trash2, X } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TradeDetail } from "@/lib/journal/types";
import {
  TradingSystemCard,
  countUnmetRequired,
  makeInitialChecksFor,
  type TradingSystemCardState,
} from "./trading-system-card";
import {
  AutoPlaceDialog,
  type AutoPlacePayload,
} from "./auto-place-dialog";
import { Switch } from "@/components/ui/switch";

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
  // Crypto futures leverage for the auto-place broker order. Stored as
  // string so the input can be empty mid-typing; coerced to number when
  // we build the broker payload.
  leverage: string;
};

type ScreenshotItem = TradeDetail["screenshots"][number];

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // 4MB
const SCREENSHOT_KINDS = ["before", "during", "after"] as const;

const screenshotLoader = ({ src }: { src: string }) => src;
const screenshotKindLabel = (kind?: ScreenshotItem["kind"] | null) => {
  if (!kind) return null;
  if (kind === "before") return "Trước lệnh";
  if (kind === "during") return "Trong lệnh";
  return "Sau lệnh";
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
  leverage: "10",
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
    // Existing trades don't carry leverage in DB — keep the default so the
    // field is still editable when the user opens the form.
    leverage: "10",
  };
}

// ──────────────────────────────────────────────────────────────────────
/**
 * Overlay URL-search-param values onto a base form state. Used when the
 * scanner analysis page deep-links to /journal/new?symbol=...&entryPrice=...
 *
 * Only runs in NEW mode — we never want to clobber a loaded trade in
 * edit mode just because the URL happens to have stray params.
 */
function applyPrefillFromParams(
  base: FormState,
  params: URLSearchParams | null,
): FormState {
  if (!params) return base;
  const next: FormState = { ...base };
  const symbol = params.get("symbol");
  if (symbol) next.symbol = symbol.toUpperCase();
  const market = params.get("market");
  if (
    market === "FOREX" ||
    market === "CRYPTO" ||
    market === "STOCK" ||
    market === "COMMODITY" ||
    market === "INDEX" ||
    market === "OTHER"
  )
    next.market = market;
  const direction = params.get("direction");
  if (direction === "LONG" || direction === "SHORT") next.direction = direction;
  const timeframe = params.get("timeframe");
  if (timeframe) next.timeframe = timeframe;
  const entryPrice = params.get("entryPrice");
  if (entryPrice) next.entryPrice = entryPrice;
  const stopLoss = params.get("stopLoss");
  if (stopLoss) next.stopLoss = stopLoss;
  const takeProfit = params.get("takeProfit");
  if (takeProfit) next.takeProfit = takeProfit;
  const lotSize = params.get("lotSize");
  if (lotSize) next.lotSize = lotSize;
  const riskAmount = params.get("riskAmount");
  if (riskAmount) next.riskAmount = riskAmount;
  const setup = params.get("setup");
  if (setup) next.setup = setup.slice(0, 2000); // schema cap
  const leverage = params.get("leverage");
  if (leverage) {
    // Always floor; never round up. Lower leverage = safer.
    const lev = Math.floor(Number(leverage));
    if (Number.isFinite(lev) && lev >= 1 && lev <= 125) {
      next.leverage = String(lev);
    }
  }
  return next;
}

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
  const searchParams = useSearchParams();
  const [state, setState] = React.useState<FormState>(() => {
    if (trade) return fromTrade(trade);
    // NEW mode only: pull prefills from URL.
    return mode === "new"
      ? applyPrefillFromParams(INITIAL, searchParams)
      : INITIAL;
  });
  const [screenshots, setScreenshots] = React.useState<ScreenshotItem[]>(
    trade?.screenshots ?? [],
  );
  const [systemState, setSystemState] = React.useState<TradingSystemCardState>(
    () => ({
      tradingSystemId: trade?.tradingSystemId ?? null,
      systemChecks: makeInitialChecksFor(trade?.systemChecks ?? null),
    }),
  );
  const [pendingSubmit, setPendingSubmit] = React.useState(false);
  // ── Auto-place toggle state ───────────────────────────────────────────
  // Default OFF. The toggle only becomes enable-able when:
  //   - mode === "new"
  //   - market === "CRYPTO"
  //   - Bitget creds are connected (status fetch below)
  // After the journal save completes, we open the confirm dialog with
  // the saved tradeJournalId — the dialog calls POST /broker/order.
  const [autoPlaceEnabled, setAutoPlaceEnabled] = React.useState(false);
  const [bitgetConnected, setBitgetConnected] = React.useState<boolean | null>(
    null,
  );
  const [autoPlacePayload, setAutoPlacePayload] =
    React.useState<AutoPlacePayload | null>(null);
  const submitLockRef = React.useRef(false);
  React.useEffect(() => {
    if (mode !== "new") return;
    let cancelled = false;
    fetch("/api/brokers/bitget/keys")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setBitgetConnected(!!j?.connected);
      })
      .catch(() => {
        if (!cancelled) setBitgetConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);
  const canAutoPlace =
    mode === "new" && state.market === "CRYPTO" && bitgetConnected === true;
  const [uploadCaption, setUploadCaption] = React.useState("");
  const [uploadKind, setUploadKind] = React.useState<"" | "before" | "during" | "after">("");
  const [uploadUrl, setUploadUrl] = React.useState("");
  const [fileInputKey, setFileInputKey] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);
  const safePreviewIndex =
    previewIndex !== null && previewIndex < screenshots.length
      ? previewIndex
      : null;
  const previewShot =
    safePreviewIndex !== null ? screenshots[safePreviewIndex] ?? null : null;

  const handlePreviewKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const isPrev =
        event.key === "ArrowLeft" ||
        event.key === "<" ||
        event.key === "," ||
        event.code === "Comma";
      const isNext =
        event.key === "ArrowRight" ||
        event.key === ">" ||
        event.key === "." ||
        event.code === "Period";
      if (isPrev) {
        event.preventDefault();
        setPreviewIndex((idx) =>
          idx === null ? idx : Math.max(0, idx - 1),
        );
      } else if (isNext) {
        event.preventDefault();
        setPreviewIndex((idx) =>
          idx === null
            ? idx
            : Math.min(screenshots.length - 1, idx + 1),
        );
      }
    },
    [screenshots.length],
  );
  const [editingCaptionId, setEditingCaptionId] = React.useState<string | null>(null);
  const [editingCaption, setEditingCaption] = React.useState("");
  const [editingKind, setEditingKind] = React.useState<"" | "before" | "during" | "after">("");

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
        // Trading system / checklist.
        tradingSystemId: systemState.tradingSystemId ?? null,
        systemChecks: systemState.systemChecks.length > 0
          ? systemState.systemChecks
          : null,
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
      // If auto-place is on, open the broker confirm dialog with the
      // saved journal id. We delay router.push until the dialog closes
      // so the user stays on the form for the broker step.
      if (
        mode === "new" &&
        autoPlaceEnabled &&
        canAutoPlace &&
        !empty(state.entryPrice) &&
        !empty(state.lotSize)
      ) {
        setAutoPlacePayload({
          tradeJournalId: data.id,
          symbol: state.symbol.trim().toUpperCase(),
          direction: state.direction,
          units: num(state.lotSize),
          entryPrice: num(state.entryPrice),
          stopLoss: empty(state.stopLoss) ? undefined : num(state.stopLoss),
          takeProfit: empty(state.takeProfit) ? undefined : num(state.takeProfit),
          leverage: Math.max(1, Math.min(125, Math.floor(num(state.leverage)) || 10)),
          marginMode: "isolated",
        });
        // Don't navigate yet — wait for dialog close.
        return;
      }
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

  const createScreenshot = useMutation({
    mutationFn: async (payload: {
      url: string;
      caption?: string;
      kind?: "before" | "during" | "after" | null;
    }) => {
      if (!trade) throw new Error("Cần lưu lệnh trước khi thêm ảnh");
      const res = await fetch(`/api/journal/${trade.id}/screenshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Không thể thêm ảnh");
      return data as ScreenshotItem;
    },
    onSuccess: (shot) => {
      setScreenshots((prev) => [...prev, shot]);
      setUploadUrl("");
      setUploadCaption("");
      setUploadKind("");
      setFileInputKey((k) => k + 1);
      toast.success("Đã thêm ảnh");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Không thể thêm ảnh");
    },
  });

  const deleteScreenshot = useMutation({
    mutationFn: async (id: string) => {
      if (!trade) throw new Error("Không tìm thấy lệnh");
      const res = await fetch(`/api/journal/${trade.id}/screenshots/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Không thể xoá ảnh");
      return id;
    },
    onSuccess: (id) => {
      setScreenshots((prev) => prev.filter((shot) => shot.id !== id));
      toast.success("Đã xoá ảnh");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Không thể xoá ảnh");
    },
  });

  const updateScreenshot = useMutation({
    mutationFn: async ({
      id,
      caption,
      kind,
    }: {
      id: string;
      caption: string;
      kind: "" | "before" | "during" | "after";
    }) => {
      if (!trade) throw new Error("Không tìm thấy lệnh");
      const res = await fetch(`/api/journal/${trade.id}/screenshots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption, kind: kind || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Không thể cập nhật ảnh");
      return data as ScreenshotItem;
    },
    onSuccess: (shot) => {
      setScreenshots((prev) =>
        prev.map((item) =>
          item.id === shot.id
            ? { ...item, caption: shot.caption, kind: shot.kind }
            : item,
        ),
      );
      setEditingCaptionId(null);
      setEditingCaption("");
      setEditingKind("");
      toast.success("Đã cập nhật ghi chú");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Không thể cập nhật ảnh");
    },
  });

  const handleFile = React.useCallback(
    (file: File) => {
      if (file.size > MAX_SCREENSHOT_BYTES) {
        toast.error("Ảnh vượt quá 4MB");
        return;
      }
      if (!file.type.startsWith("image/")) {
        toast.error("Chỉ chấp nhận tệp ảnh");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result ?? "");
        if (!url) {
          toast.error("Không đọc được ảnh");
          return;
        }
        createScreenshot.mutate({
          url,
          caption: uploadCaption.trim() || undefined,
          kind: uploadKind || null,
        });
      };
      reader.onerror = () => {
        toast.error("Không đọc được ảnh");
      };
      reader.readAsDataURL(file);
    },
    [createScreenshot, uploadCaption, uploadKind],
  );

  const validForm =
    !empty(state.symbol) &&
    !empty(state.entryPrice) &&
    !empty(state.lotSize) &&
    !empty(state.openedAt);

  const canUpload = mode === "edit" && !!trade;

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      if (!canUpload) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      handleFile(file);
    },
    [canUpload, handleFile],
  );

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

      <TradingSystemCard
        mode={mode}
        initialTradingSystemId={trade?.tradingSystemId ?? null}
        initialSystemChecks={trade?.systemChecks ?? []}
        state={systemState}
        onChange={setSystemState}
      />

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ảnh giao dịch</CardTitle>
          <CardDescription>
            Đính kèm hình ảnh trước, trong hoặc sau khi vào lệnh.
          </CardDescription>
        </CardHeader>
  <CardContent className="space-y-4" tabIndex={0}>
          {!canUpload ? (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Lưu lệnh trước khi thêm ảnh.
            </div>
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label="Dán ảnh nhanh">
                  <div className="flex flex-wrap items-center gap-2">
                    <Textarea
                      rows={2}
                      placeholder="Dán ảnh vào đây (Ctrl/Cmd + V)"
                      className="min-h-[38px] flex-1 resize-none text-xs"
                      onPaste={handlePaste}
                      onChange={(e) => {
                        e.currentTarget.value = "";
                      }}
                      aria-label="Dán ảnh vào đây"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Chọn file
                    </Button>
                    <input
                      ref={fileInputRef}
                      key={fileInputKey}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFile(file);
                        e.currentTarget.value = "";
                      }}
                    />
                  </div>
                </Field>
                <Field label="Ảnh từ URL">
                  <div className="flex gap-2">
                    <Input
                      value={uploadUrl}
                      onChange={(e) => setUploadUrl(e.target.value)}
                      placeholder="https://... hoặc data:image/..."
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!uploadUrl.trim() || createScreenshot.isPending}
                      onClick={() =>
                        createScreenshot.mutate({
                          url: uploadUrl.trim(),
                          caption: uploadCaption.trim() || undefined,
                          kind: uploadKind || null,
                        })
                      }
                    >
                      Thêm
                    </Button>
                  </div>
                </Field>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label="Ghi chú ảnh">
                  <Input
                    value={uploadCaption}
                    onChange={(e) => setUploadCaption(e.target.value)}
                    placeholder="Ví dụ: Điểm vào lệnh"
                  />
                </Field>
                <Field label="Loại ảnh">
                  <Select
                    value={uploadKind}
                    onValueChange={(v) =>
                      setUploadKind(v as "" | "before" | "during" | "after")
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Chọn loại" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Không phân loại</SelectItem>
                      {SCREENSHOT_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {kind === "before"
                            ? "Trước lệnh"
                            : kind === "during"
                              ? "Trong lệnh"
                              : "Sau lệnh"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                Ảnh tải lên giới hạn 4MB. Chỉ hỗ trợ định dạng ảnh (png, jpg,...).
              </p>
              <p className="text-xs text-muted-foreground">
                Mẹo: có thể dán ảnh trực tiếp bằng Ctrl/Cmd + V.
              </p>
            </>
          )}

          {screenshots.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Chưa có ảnh đính kèm.
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {screenshots.map((shot, index) => {
                  const isEditing = editingCaptionId === shot.id;
                  return (
                    <div
                      key={shot.id}
                      className="group relative overflow-hidden rounded-lg border bg-card/40"
                    >
                      <button
                        type="button"
                        className="relative h-40 w-full text-left"
                        onClick={() => setPreviewIndex(index)}
                        aria-label="Phóng to ảnh"
                      >
                        <Image
                          src={shot.url}
                          alt={shot.caption ?? "Trade screenshot"}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          loader={screenshotLoader}
                          unoptimized
                        />
                        <span className="absolute inset-0 bg-black/10 opacity-0 transition group-hover:opacity-100" />
                      </button>
                      <button
                        type="button"
                        className="absolute right-2 top-2 rounded-full border bg-background/90 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100"
                        onClick={() => deleteScreenshot.mutate(shot.id)}
                        disabled={deleteScreenshot.isPending}
                        aria-label="Xoá ảnh"
                      >
                        <X className="size-3" />
                      </button>
                      <div className="space-y-1 p-2 text-xs text-muted-foreground">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Input
                              value={editingCaption}
                              onChange={(e) => setEditingCaption(e.target.value)}
                              placeholder="Ghi chú ảnh"
                            />
                            <Select
                              value={editingKind}
                              onValueChange={(value) =>
                                setEditingKind(value as "" | "before" | "during" | "after")
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Chọn loại" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="">Không phân loại</SelectItem>
                                {SCREENSHOT_KINDS.map((kind) => (
                                  <SelectItem key={kind} value={kind}>
                                    {screenshotKindLabel(kind) ?? kind}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="xs"
                                disabled={updateScreenshot.isPending}
                                onClick={() =>
                                  updateScreenshot.mutate({
                                    id: shot.id,
                                    caption: editingCaption,
                                    kind: editingKind,
                                  })
                                }
                              >
                                Lưu
                              </Button>
                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  setEditingCaptionId(null);
                                  setEditingCaption("");
                                  setEditingKind("");
                                }}
                              >
                                Hủy
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium text-foreground">
                              {shot.caption || "(Không có ghi chú)"}
                            </div>
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setEditingCaptionId(shot.id);
                                setEditingCaption(shot.caption ?? "");
                                setEditingKind((shot.kind ?? "") as "" | "before" | "during" | "after");
                              }}
                            >
                              Sửa
                            </Button>
                          </div>
                        )}
                        {shot.kind ? (
                          <div>{screenshotKindLabel(shot.kind)}</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <Dialog
                open={!!previewShot}
                onOpenChange={(open) => {
                  if (!open) setPreviewIndex(null);
                }}
              >
                <DialogContent
                  showCloseButton={false}
                  fullscreen
                  className="flex flex-col gap-0 overflow-hidden bg-black p-0"
                  onKeyDown={handlePreviewKeyDown}
                >
                  {/* Hidden accessible title for screen readers */}
                  <DialogTitle className="sr-only">
                    {previewShot?.caption || "Ảnh giao dịch"}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    {previewShot?.kind ? screenshotKindLabel(previewShot.kind) : "Xem ảnh fullscreen"}
                  </DialogDescription>

                  {previewShot ? (
                    <div className="relative h-screen w-screen">
                      {/* ── Main image ─────────────────────────────── */}
                      <Image
                        src={previewShot.url}
                        alt={previewShot.caption ?? "Trade screenshot"}
                        fill
                        className="object-contain"
                        sizes="100vw"
                        loader={screenshotLoader}
                        unoptimized
                      />

                      {/* ── Top bar: left=title+kind, right=download+counter+close ── */}
                      <div className="absolute left-0 top-0 z-20 flex w-full items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6 pt-3">
                        {/* Left: title + kind */}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white drop-shadow">
                            {previewShot.caption || "Ảnh giao dịch"}
                          </p>
                          {previewShot.kind ? (
                            <p className="mt-0.5 text-xs text-white/70">
                              {screenshotKindLabel(previewShot.kind)}
                            </p>
                          ) : null}
                        </div>
                        {/* Right: download + counter + close */}
                        <div className="flex shrink-0 items-center gap-2">
                          <a
                            href={previewShot.url}
                            download
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/30"
                            aria-label="Tải ảnh"
                          >
                            <Download className="size-3.5" />
                            Tải ảnh
                          </a>
                          <div className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
                            <span>{(safePreviewIndex ?? 0) + 1} / {screenshots.length}</span>
                            <div className="mx-1 h-3 w-px bg-white/30" />
                            <DialogClose
                              render={
                                <button
                                  type="button"
                                  className="flex items-center justify-center rounded-full p-0.5 transition hover:bg-white/20"
                                  aria-label="Đóng"
                                />
                              }
                            >
                              <X className="size-3.5" />
                            </DialogClose>
                          </div>
                        </div>
                      </div>

                      {/* ── Nav: Prev ───────────────────────────────── */}
                      <button
                        type="button"
                        className="group absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/40 p-3 text-white backdrop-blur-sm transition hover:bg-black/70 disabled:pointer-events-none disabled:opacity-20"
                        onClick={() =>
                          setPreviewIndex((idx) =>
                            idx !== null ? Math.max(0, idx - 1) : idx,
                          )
                        }
                        disabled={safePreviewIndex === 0}
                        aria-label="Ảnh trước"
                      >
                        <ChevronLeft className="size-6 transition group-hover:scale-110" />
                      </button>

                      {/* ── Nav: Next ───────────────────────────────── */}
                      <button
                        type="button"
                        className="group absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/40 p-3 text-white backdrop-blur-sm transition hover:bg-black/70 disabled:pointer-events-none disabled:opacity-20"
                        onClick={() =>
                          setPreviewIndex((idx) =>
                            idx !== null
                              ? Math.min(screenshots.length - 1, idx + 1)
                              : idx,
                          )
                        }
                        disabled={
                          safePreviewIndex === null ||
                          safePreviewIndex >= screenshots.length - 1
                        }
                        aria-label="Ảnh tiếp theo"
                      >
                        <ChevronRight className="size-6 transition group-hover:scale-110" />
                      </button>

                    </div>
                  ) : null}
                </DialogContent>
              </Dialog>
            </>
          )}
        </CardContent>
      </Card>

      {mode === "new" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Đặt lệnh thật trên Bitget</CardTitle>
            <CardDescription>
              Sau khi tạo lệnh trong nhật ký, tự động gửi lệnh limit sang Bitget USDT-Futures.
              Lệnh có Stop Loss / Take Profit nếu bạn điền ở trên.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md border bg-card/40 p-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    id="auto-place"
                    checked={autoPlaceEnabled && canAutoPlace}
                    disabled={!canAutoPlace}
                    onCheckedChange={(v) => setAutoPlaceEnabled(!!v)}
                  />
                  <Label htmlFor="auto-place" className="cursor-pointer">
                    Tự đặt lệnh trên Bitget khi lưu
                  </Label>
                  {autoPlaceEnabled && canAutoPlace ? (
                    <Badge variant="destructive" className="text-[10px]">
                      Lệnh thật
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {bitgetConnected === null
                    ? "Đang kiểm tra kết nối Bitget…"
                    : !bitgetConnected
                      ? "Chưa kết nối Bitget. Vào Cài đặt → Sàn giao dịch để thêm API key."
                      : state.market !== "CRYPTO"
                        ? "Chỉ hỗ trợ thị trường CRYPTO trong giai đoạn này."
                        : "Khối lượng dưới đây là số coin gốc (vd 0.001 BTC), KHÔNG phải lot forex."}
                </p>
              </div>
            </div>

            {canAutoPlace ? (
              <div className="grid grid-cols-[120px_1fr] items-center gap-3 rounded-md border bg-card/40 p-3">
                <Label htmlFor="leverage">Đòn bẩy (x)</Label>
                <Input
                  id="leverage"
                  inputMode="numeric"
                  className="num"
                  value={state.leverage}
                  onChange={(e) =>
                    update(
                      "leverage",
                      e.target.value.replace(/[^0-9]/g, ""),
                    )
                  }
                  placeholder="10"
                />
                <span className="col-span-2 text-xs text-muted-foreground">
                  Gợi ý từ Calculator (an toàn — buffer 50%, làm tròn xuống) được tự điền nếu bạn
                  đi từ trang Tính khối lượng. Cho phép 1–125x. Mặc định 10x.
                </span>
              </div>
            ) : null}

            {autoPlaceEnabled && canAutoPlace ? (
              <p className="text-xs text-muted-foreground">
                Khi nhấn “Tạo lệnh”, nhật ký được lưu trước; sau đó một hộp xác nhận
                sẽ hiện ra với thông tin lệnh thật để bạn duyệt.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
          onClick={() => {
            if (submitLockRef.current) return;
            submitLockRef.current = true;
            setTimeout(() => {
              submitLockRef.current = false;
            }, 1500);
            const missing = countUnmetRequired(systemState.systemChecks);
            if (missing > 0) {
              setPendingSubmit(true);
              return;
            }
            submit.mutate();
          }}
        >
          <Save className="size-4" />
          {submit.isPending
            ? "Đang lưu…"
            : mode === "new"
              ? "Tạo lệnh"
              : "Lưu thay đổi"}
        </Button>
      </div>

      <ChecklistWarnDialog
        open={pendingSubmit}
        onOpenChange={setPendingSubmit}
        missingCount={countUnmetRequired(systemState.systemChecks)}
        onConfirm={() => {
          setPendingSubmit(false);
          submit.mutate();
        }}
      />

      <AutoPlaceDialog
        open={autoPlacePayload !== null}
        onOpenChange={(open) => {
          if (!open) {
            const id = autoPlacePayload?.tradeJournalId;
            setAutoPlacePayload(null);
            if (id) router.push(`/journal/${id}`);
          }
        }}
        payload={autoPlacePayload}
      />
    </div>
  );
}

function ChecklistWarnDialog({
  open,
  onOpenChange,
  missingCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  missingCount: number;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bỏ qua checklist bắt buộc?</DialogTitle>
          <DialogDescription>
            Bạn còn {missingCount} mục bắt buộc trong hệ thống chưa tick. Bạn
            có chắc muốn tạo lệnh không?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Quay lại tick
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Vẫn tạo lệnh
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
