"use client";

/**
 * Broker order panel on the journal detail page.
 *
 * Lists each BrokerOrder linked to this journal entry and, for any in
 * PLACED / PLACED_NO_SL, offers a "Huỷ lệnh trên Bitget" button.
 *
 * Cancel is a real-money write — requires confirm dialog + typing "OK".
 * After Bitget confirms, the journal list will refetch (status switches
 * to CANCELED) and this panel will refresh.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  MoveHorizontal,
  PencilLine,
  PowerOff,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BrokerOrderRow = {
  id: string;
  broker: string;
  status: string;
  side: string;
  orderType: string;
  symbol: string;
  size: string;
  price: string | null;
  presetStopLoss: string | null;
  presetTakeProfit: string | null;
  leverage: number;
  externalOrderId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

const statusBadge = (s: string) => {
  const map: Record<string, { label: string; variant: "default" | "destructive" | "outline" | "secondary" }> = {
    PENDING: { label: "Đang chờ Bitget", variant: "outline" },
    PLACED: { label: "Đã đặt (treo)", variant: "default" },
    PLACED_NO_SL: { label: "Đã đặt · CHƯA CÓ SL", variant: "destructive" },
    FILLED: { label: "Đã khớp", variant: "default" },
    FAILED: { label: "Thất bại", variant: "destructive" },
    CANCELLED: { label: "Đã huỷ", variant: "secondary" },
    UNKNOWN: { label: "Không rõ", variant: "secondary" },
  };
  return map[s] ?? { label: s, variant: "outline" as const };
};

export function BrokerOrderPanel({ tradeJournalId }: { tradeJournalId: string }) {
  const queryClient = useQueryClient();
  const [confirmTarget, setConfirmTarget] = React.useState<BrokerOrderRow | null>(
    null,
  );
  const [confirmText, setConfirmText] = React.useState("");
  // Separate state for the "move SL to entry" confirm dialog so the two
  // flows can't accidentally cross-fire.
  const [moveSLTarget, setMoveSLTarget] = React.useState<BrokerOrderRow | null>(
    null,
  );
  const [moveSLConfirm, setMoveSLConfirm] = React.useState("");
  const [closeTarget, setCloseTarget] = React.useState<BrokerOrderRow | null>(
    null,
  );
  const [closeConfirm, setCloseConfirm] = React.useState("");
  const [tpslTarget, setTpslTarget] = React.useState<BrokerOrderRow | null>(
    null,
  );
  const [tpslSL, setTpslSL] = React.useState("");
  const [tpslTP, setTpslTP] = React.useState("");
  const [tpslConfirm, setTpslConfirm] = React.useState("");

  const orders = useQuery<{ orders: BrokerOrderRow[] }>({
    queryKey: ["broker-orders", tradeJournalId],
    queryFn: async () => {
      const res = await fetch(`/api/journal/${tradeJournalId}/broker-orders`);
      if (!res.ok) throw new Error("Không tải được lệnh broker.");
      return (await res.json()) as { orders: BrokerOrderRow[] };
    },
  });

  // Read-only accounts see order STATUS but no write actions — the server
  // enforces this too (403); hiding the buttons avoids a dead-end click.
  const entitlement = useQuery<{ autoTrade: boolean }>({
    queryKey: ["broker-entitlements"],
    queryFn: async () => {
      const res = await fetch("/api/brokers/entitlements");
      if (!res.ok) return { autoTrade: false };
      return (await res.json()) as { autoTrade: boolean };
    },
    staleTime: 5 * 60_000,
  });
  const canWrite = entitlement.data?.autoTrade === true;

  const moveSL = useMutation({
    mutationFn: async (input: { brokerOrderId: string; confirmText: string }) => {
      const res = await fetch("/api/brokers/bitget/move-sl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brokerOrderId: input.brokerOrderId,
          target: "entry",
          confirmText: input.confirmText,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Sửa SL thất bại.");
      return j as { ok: true; newSL: string };
    },
    onSuccess: (data) => {
      toast.success(`Đã kéo SL về Entry · ${data.newSL}`);
      setMoveSLTarget(null);
      setMoveSLConfirm("");
      queryClient.invalidateQueries({
        queryKey: ["broker-orders", tradeJournalId],
      });
      queryClient.invalidateQueries({ queryKey: ["journal"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Sửa SL thất bại.");
    },
  });

  const setTpsl = useMutation({
    mutationFn: async (input: {
      brokerOrderId: string;
      stopLoss?: number;
      takeProfit?: number;
      confirmText: string;
    }) => {
      const res = await fetch("/api/brokers/bitget/set-tpsl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Sửa SL/TP thất bại.");
      return j as { ok: true; sl?: string; tp?: string };
    },
    onSuccess: (data) => {
      const parts = [
        data.sl ? `SL ${data.sl}` : null,
        data.tp ? `TP ${data.tp}` : null,
      ].filter(Boolean);
      toast.success(`Đã cập nhật ${parts.join(" · ")} trên Bitget.`);
      setTpslTarget(null);
      setTpslSL("");
      setTpslTP("");
      setTpslConfirm("");
      queryClient.invalidateQueries({
        queryKey: ["broker-orders", tradeJournalId],
      });
      queryClient.invalidateQueries({ queryKey: ["journal"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Sửa SL/TP thất bại.");
    },
  });

  const closePos = useMutation({
    mutationFn: async (input: { brokerOrderId: string; confirmText: string }) => {
      const res = await fetch("/api/brokers/bitget/close-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Đóng vị thế thất bại.");
      return j as { ok: true; synced: boolean };
    },
    onSuccess: (data) => {
      toast.success(
        data.synced
          ? "Đã đóng vị thế trên Bitget · nhật ký đã cập nhật PnL."
          : "Đã đóng vị thế trên Bitget · PnL sẽ đồng bộ ở lần sau.",
      );
      setCloseTarget(null);
      setCloseConfirm("");
      queryClient.invalidateQueries({
        queryKey: ["broker-orders", tradeJournalId],
      });
      queryClient.invalidateQueries({ queryKey: ["journal"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Đóng vị thế thất bại.");
    },
  });

  const cancel = useMutation({
    mutationFn: async (input: { brokerOrderId: string; confirmText: string }) => {
      const res = await fetch("/api/brokers/bitget/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Huỷ thất bại.");
      return j;
    },
    onSuccess: () => {
      toast.success("Đã huỷ lệnh trên Bitget.");
      setConfirmTarget(null);
      setConfirmText("");
      queryClient.invalidateQueries({
        queryKey: ["broker-orders", tradeJournalId],
      });
      queryClient.invalidateQueries({ queryKey: ["journal"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Huỷ thất bại.");
    },
  });

  if (orders.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lệnh thật trên Bitget</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Đang tải…</p>
        </CardContent>
      </Card>
    );
  }
  if (orders.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lệnh thật trên Bitget</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-rose-500">
            {orders.error instanceof Error ? orders.error.message : "Lỗi"}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (!orders.data || orders.data.orders.length === 0) {
    return null; // no broker order — hide panel entirely
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lệnh thật trên Bitget</CardTitle>
        <CardDescription>
          Liên kết giữa entry nhật ký và lệnh Bitget. Huỷ lệnh ở đây sẽ gọi
          API Bitget thật.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {orders.data.orders.map((o) => {
          const badge = statusBadge(o.status);
          const canCancel =
            canWrite &&
            (o.status === "PLACED" || o.status === "PLACED_NO_SL");
          const canMoveSL = canWrite && o.status === "FILLED";
          return (
            <div
              key={o.id}
              className="space-y-2 rounded-md border bg-card/40 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="font-mono text-xs">
                    {o.symbol} · {o.side.toUpperCase()} · {o.leverage}x
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canMoveSL ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTpslTarget(o);
                        setTpslSL(o.presetStopLoss ?? "");
                        setTpslTP(o.presetTakeProfit ?? "");
                        setTpslConfirm("");
                      }}
                    >
                      <PencilLine className="size-4" />
                      Sửa SL/TP
                    </Button>
                  ) : null}
                  {canMoveSL ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMoveSLTarget(o);
                        setMoveSLConfirm("");
                      }}
                    >
                      <MoveHorizontal className="size-4" />
                      Kéo SL về Entry
                    </Button>
                  ) : null}
                  {canMoveSL ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setCloseTarget(o);
                        setCloseConfirm("");
                      }}
                    >
                      <PowerOff className="size-4" />
                      Đóng vị thế (market)
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setConfirmTarget(o);
                        setConfirmText("");
                      }}
                    >
                      <XCircle className="size-4" />
                      Huỷ lệnh trên Bitget
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <Row k="Loại" v={o.orderType} />
                <Row k="Khối lượng" v={`${o.size}`} />
                {o.price ? <Row k="Giá" v={o.price} /> : null}
                {o.presetStopLoss ? <Row k="SL" v={o.presetStopLoss} /> : null}
                {o.presetTakeProfit ? <Row k="TP" v={o.presetTakeProfit} /> : null}
                {o.externalOrderId ? (
                  <Row k="Order ID" v={o.externalOrderId} mono />
                ) : null}
                <Row
                  k="Tạo lúc"
                  v={new Date(o.createdAt).toLocaleString("vi-VN")}
                />
              </div>

              {o.status === "PLACED_NO_SL" ? (
                <div className="flex gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Bitget không xác nhận SL gắn vào lệnh. Vào app Bitget kiểm
                    tra Plan Orders (TP/SL) và đặt SL thủ công ngay.
                  </span>
                </div>
              ) : null}
              {o.errorMessage ? (
                <p className="text-xs text-muted-foreground">
                  Ghi chú: {o.errorMessage}
                </p>
              ) : null}
            </div>
          );
        })}
      </CardContent>

      <Dialog
        open={!!confirmTarget}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmTarget(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-amber-500" />
              Huỷ lệnh thật trên Bitget?
            </DialogTitle>
            <DialogDescription>
              Lệnh limit đang treo trên Bitget sẽ bị huỷ ngay lập tức và{" "}
              <strong>không thể hoàn tác</strong>.
            </DialogDescription>
          </DialogHeader>

          {confirmTarget ? (
            <div className="space-y-2 rounded-md border bg-card/40 p-3 text-sm">
              <Row k="Cặp" v={confirmTarget.symbol} mono />
              <Row k="Hướng" v={confirmTarget.side.toUpperCase()} />
              <Row k="Khối lượng" v={confirmTarget.size} />
              {confirmTarget.price ? (
                <Row k="Giá" v={confirmTarget.price} />
              ) : null}
              {confirmTarget.externalOrderId ? (
                <Row
                  k="Order ID"
                  v={confirmTarget.externalOrderId}
                  mono
                />
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="cancel-confirm">
              Gõ <code className="rounded bg-muted px-1 font-mono">OK</code> để
              xác nhận huỷ
            </Label>
            <Input
              id="cancel-confirm"
              autoFocus
              placeholder="OK"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={cancel.isPending}
            />
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmTarget(null);
                setConfirmText("");
              }}
              disabled={cancel.isPending}
            >
              Quay lại
            </Button>
            <Button
              variant="destructive"
              disabled={
                !confirmTarget ||
                cancel.isPending ||
                confirmText.trim().toUpperCase() !== "OK"
              }
              onClick={() => {
                if (!confirmTarget) return;
                cancel.mutate({
                  brokerOrderId: confirmTarget.id,
                  confirmText: confirmText.trim().toUpperCase(),
                });
              }}
            >
              {cancel.isPending ? "Đang huỷ…" : "Huỷ lệnh"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── "Kéo SL về Entry" confirm dialog ───────────────────────── */}
      <Dialog
        open={!!moveSLTarget}
        onOpenChange={(open) => {
          if (!open) {
            setMoveSLTarget(null);
            setMoveSLConfirm("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MoveHorizontal className="size-5 text-amber-500" />
              Kéo Stop Loss về giá vào (Entry)?
            </DialogTitle>
            <DialogDescription>
              Đặt SL mới = giá vào của lệnh này. Khi giá quay về entry, vị
              thế sẽ tự đóng ở mức hoà vốn (không lời không lỗ, đã trừ phí).
            </DialogDescription>
          </DialogHeader>

          {moveSLTarget ? (
            <div className="space-y-2 rounded-md border bg-card/40 p-3 text-sm">
              <Row k="Cặp" v={moveSLTarget.symbol} mono />
              <Row k="Hướng" v={moveSLTarget.side.toUpperCase()} />
              <Row k="Khối lượng" v={moveSLTarget.size} />
              {moveSLTarget.presetStopLoss ? (
                <Row k="SL hiện tại" v={moveSLTarget.presetStopLoss} />
              ) : (
                <Row k="SL hiện tại" v="(chưa đặt)" />
              )}
              <p className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                SL mới sẽ được đặt = entry trong nhật ký, làm tròn theo tick
                của cặp. Nếu giá hiện tại đã dưới entry (LONG) hoặc trên entry
                (SHORT), lệnh có thể bị khớp SL ngay lập tức.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="movesl-confirm">
              Gõ <code className="rounded bg-muted px-1 font-mono">OK</code> để
              xác nhận
            </Label>
            <Input
              id="movesl-confirm"
              autoFocus
              placeholder="OK"
              value={moveSLConfirm}
              onChange={(e) => setMoveSLConfirm(e.target.value)}
              disabled={moveSL.isPending}
            />
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => {
                setMoveSLTarget(null);
                setMoveSLConfirm("");
              }}
              disabled={moveSL.isPending}
            >
              Quay lại
            </Button>
            <Button
              disabled={
                !moveSLTarget ||
                moveSL.isPending ||
                moveSLConfirm.trim().toUpperCase() !== "OK"
              }
              onClick={() => {
                if (!moveSLTarget) return;
                moveSL.mutate({
                  brokerOrderId: moveSLTarget.id,
                  confirmText: moveSLConfirm.trim().toUpperCase(),
                });
              }}
            >
              {moveSL.isPending ? "Đang đặt SL…" : "Kéo SL về Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── "Sửa SL/TP" dialog ─────────────────────────────────────── */}
      <Dialog
        open={!!tpslTarget}
        onOpenChange={(open) => {
          if (!open) {
            setTpslTarget(null);
            setTpslSL("");
            setTpslTP("");
            setTpslConfirm("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PencilLine className="size-5 text-amber-500" />
              Sửa Stop Loss / Take Profit
            </DialogTitle>
            <DialogDescription>
              Đặt lại SL/TP cho vị thế đang mở. Giá mới thay thế trigger cũ
              trên Bitget ngay khi xác nhận.
            </DialogDescription>
          </DialogHeader>

          {tpslTarget ? (
            <div className="space-y-3">
              <div className="space-y-2 rounded-md border bg-card/40 p-3 text-sm">
                <Row k="Cặp" v={tpslTarget.symbol} mono />
                <Row k="Hướng" v={tpslTarget.side.toUpperCase()} />
                <Row
                  k="SL hiện tại"
                  v={tpslTarget.presetStopLoss ?? "(chưa đặt)"}
                />
                <Row
                  k="TP hiện tại"
                  v={tpslTarget.presetTakeProfit ?? "(chưa đặt)"}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tpsl-sl">Stop Loss mới</Label>
                  <Input
                    id="tpsl-sl"
                    inputMode="decimal"
                    className="num"
                    value={tpslSL}
                    onChange={(e) => setTpslSL(e.target.value)}
                    placeholder="Để trống nếu giữ nguyên"
                    disabled={setTpsl.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tpsl-tp">Take Profit mới</Label>
                  <Input
                    id="tpsl-tp"
                    inputMode="decimal"
                    className="num"
                    value={tpslTP}
                    onChange={(e) => setTpslTP(e.target.value)}
                    placeholder="Để trống nếu giữ nguyên"
                    disabled={setTpsl.isPending}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Giá sẽ được làm tròn theo tick của cặp, luôn về phía xa entry.
                LONG: SL &lt; entry &lt; TP. SHORT: TP &lt; entry &lt; SL.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="tpsl-confirm">
              Gõ <code className="rounded bg-muted px-1 font-mono">OK</code> để
              xác nhận
            </Label>
            <Input
              id="tpsl-confirm"
              placeholder="OK"
              value={tpslConfirm}
              onChange={(e) => setTpslConfirm(e.target.value)}
              disabled={setTpsl.isPending}
            />
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => {
                setTpslTarget(null);
                setTpslSL("");
                setTpslTP("");
                setTpslConfirm("");
              }}
              disabled={setTpsl.isPending}
            >
              Quay lại
            </Button>
            <Button
              disabled={
                !tpslTarget ||
                setTpsl.isPending ||
                tpslConfirm.trim().toUpperCase() !== "OK" ||
                (tpslSL.trim() === "" && tpslTP.trim() === "")
              }
              onClick={() => {
                if (!tpslTarget) return;
                const sl = Number(tpslSL.replace(",", "."));
                const tp = Number(tpslTP.replace(",", "."));
                setTpsl.mutate({
                  brokerOrderId: tpslTarget.id,
                  ...(tpslSL.trim() !== "" && Number.isFinite(sl) && sl > 0
                    ? { stopLoss: sl }
                    : {}),
                  ...(tpslTP.trim() !== "" && Number.isFinite(tp) && tp > 0
                    ? { takeProfit: tp }
                    : {}),
                  confirmText: tpslConfirm.trim().toUpperCase(),
                });
              }}
            >
              {setTpsl.isPending ? "Đang cập nhật…" : "Cập nhật SL/TP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── "Đóng vị thế (market)" confirm dialog ──────────────────── */}
      <Dialog
        open={!!closeTarget}
        onOpenChange={(open) => {
          if (!open) {
            setCloseTarget(null);
            setCloseConfirm("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PowerOff className="size-5 text-rose-500" />
              Đóng vị thế ngay ở giá market?
            </DialogTitle>
            <DialogDescription>
              Đóng toàn bộ vị thế ngay lập tức ở giá thị trường hiện tại.
              Không thể hoàn tác. Lời/lỗ sẽ được chốt và đồng bộ về nhật ký.
            </DialogDescription>
          </DialogHeader>

          {closeTarget ? (
            <div className="space-y-2 rounded-md border bg-card/40 p-3 text-sm">
              <Row k="Cặp" v={closeTarget.symbol} mono />
              <Row k="Hướng" v={closeTarget.side.toUpperCase()} />
              <Row k="Khối lượng" v={closeTarget.size} />
              <p className="rounded-md border border-rose-400/40 bg-rose-400/10 p-2 text-xs text-rose-700 dark:text-rose-300">
                Lệnh đóng theo giá thị trường có thể trượt giá (slippage) so với
                giá hiển thị, nhất là lúc biến động mạnh.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="close-confirm">
              Gõ <code className="rounded bg-muted px-1 font-mono">OK</code> để
              xác nhận đóng
            </Label>
            <Input
              id="close-confirm"
              autoFocus
              placeholder="OK"
              value={closeConfirm}
              onChange={(e) => setCloseConfirm(e.target.value)}
              disabled={closePos.isPending}
            />
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => {
                setCloseTarget(null);
                setCloseConfirm("");
              }}
              disabled={closePos.isPending}
            >
              Quay lại
            </Button>
            <Button
              variant="destructive"
              disabled={
                !closeTarget ||
                closePos.isPending ||
                closeConfirm.trim().toUpperCase() !== "OK"
              }
              onClick={() => {
                if (!closeTarget) return;
                closePos.mutate({
                  brokerOrderId: closeTarget.id,
                  confirmText: closeConfirm.trim().toUpperCase(),
                });
              }}
            >
              {closePos.isPending ? "Đang đóng…" : "Đóng vị thế ngay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Row({
  k,
  v,
  mono,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{v}</span>
    </div>
  );
}
