"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  CheckCircle2,
  CloudUpload,
  FileWarning,
  Inbox,
  Loader2,
  RefreshCw,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types — match the JSON the preview API returns (Dates as ISO strings).
// ──────────────────────────────────────────────────────────────────────
type PreviewTrade = {
  externalTicket: string;
  symbol: string;
  market: "FOREX" | "CRYPTO" | "OTHER";
  direction: "LONG" | "SHORT";
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: string;
  closedAt: string;
  pnl: number;
  commission?: number;
  swap?: number;
  comment?: string;
};

type PreviewResponse = {
  broker: "MT4" | "MT5";
  parsed: number;
  skipped: number;
  trades: PreviewTrade[];
};

type CommitResponse = {
  inserted: number;
  skipped: number;
  errors: { ticket: string; message: string }[];
};

type SortKey =
  | "ticket"
  | "symbol"
  | "direction"
  | "size"
  | "openedAt"
  | "closedAt"
  | "pnl"
  | "duration";

const NONE_ACCOUNT = "__none";

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────
function fmtNum(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(n);
}

function tradeKey(t: PreviewTrade): string {
  return `${t.externalTicket}|${t.symbol}|${t.openedAt}|${t.lotSize}|${t.direction}`;
}

function durationMs(t: PreviewTrade): number {
  const a = Date.parse(t.openedAt);
  const b = Date.parse(t.closedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return b - a;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  if (hrs < 24) return m === 0 ? `${hrs}h` : `${hrs}h ${m}m`;
  const days = Math.floor(hrs / 24);
  const h = hrs % 24;
  return h === 0 ? `${days}d` : `${days}d ${h}h`;
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────
export function MtImportClient({
  accounts,
}: {
  accounts: { id: string; name: string; currency: string }[];
}) {
  const router = useRouter();
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [accountId, setAccountId] = React.useState<string>(NONE_ACCOUNT);
  const [dedupe, setDedupe] = React.useState(true);
  const [sort, setSort] = React.useState<{
    key: SortKey;
    dir: "asc" | "desc";
  }>({ key: "openedAt", dir: "asc" });
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // ── Preview mutation ────────────────────────────────────────────────
  const previewMut = useMutation({
    mutationFn: async (html: string): Promise<PreviewResponse> => {
      const res = await fetch("/api/journal/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ html }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? "Không phân tích được tệp");
      }
      return (await res.json()) as PreviewResponse;
    },
    onSuccess: (data) => {
      setPreview(data);
      // Default-select all trades
      setSelected(new Set(data.trades.map(tradeKey)));
      if (data.parsed === 0) {
        toast.warning("Không tìm thấy lệnh hợp lệ trong tệp.");
      } else {
        toast.success(
          `Đã đọc ${data.parsed} lệnh từ ${data.broker}` +
            (data.skipped > 0 ? ` (bỏ qua ${data.skipped} dòng).` : "."),
        );
      }
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Lỗi không xác định";
      toast.error(msg);
    },
  });

  // ── Commit mutation ─────────────────────────────────────────────────
  const commitMut = useMutation({
    mutationFn: async (): Promise<CommitResponse> => {
      if (!preview) throw new Error("Chưa có preview");
      const trades = preview.trades.filter((t) => selected.has(tradeKey(t)));
      if (trades.length === 0) throw new Error("Chưa chọn lệnh nào");
      const res = await fetch("/api/journal/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trades,
          accountId: accountId === NONE_ACCOUNT ? null : accountId,
          dedupe,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? "Nhập thất bại");
      }
      return (await res.json()) as CommitResponse;
    },
    onSuccess: (data) => {
      toast.success(
        `Đã nhập ${data.inserted} lệnh.` +
          (data.skipped > 0 ? ` Bỏ qua ${data.skipped} (trùng).` : "") +
          (data.errors.length > 0 ? ` ${data.errors.length} lỗi.` : ""),
      );
      setTimeout(() => {
        router.push(`/journal?imported=${data.inserted}`);
      }, 1500);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Lỗi không xác định";
      toast.error(msg);
    },
  });

  // ── File handling ───────────────────────────────────────────────────
  const handleFile = React.useCallback(
    (file: File) => {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Tệp vượt quá 5MB");
        return;
      }
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".html") && !lower.endsWith(".htm")) {
        toast.error("Chỉ chấp nhận tệp .html / .htm");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const html = String(reader.result ?? "");
        previewMut.mutate(html);
      };
      reader.onerror = () => {
        toast.error("Không đọc được tệp");
      };
      reader.readAsText(file);
    },
    [previewMut],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ── Sorted view ─────────────────────────────────────────────────────
  const sortedTrades = React.useMemo(() => {
    if (!preview) return [];
    const arr = [...preview.trades];
    const dir = sort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sort.key) {
        case "ticket":
          return a.externalTicket.localeCompare(b.externalTicket) * dir;
        case "symbol":
          return a.symbol.localeCompare(b.symbol) * dir;
        case "direction":
          return a.direction.localeCompare(b.direction) * dir;
        case "size":
          return (a.lotSize - b.lotSize) * dir;
        case "openedAt":
          return (Date.parse(a.openedAt) - Date.parse(b.openedAt)) * dir;
        case "closedAt":
          return (Date.parse(a.closedAt) - Date.parse(b.closedAt)) * dir;
        case "pnl":
          return (a.pnl - b.pnl) * dir;
        case "duration":
          return (durationMs(a) - durationMs(b)) * dir;
        default:
          return 0;
      }
    });
    return arr;
  }, [preview, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  const allKeys = React.useMemo(
    () => sortedTrades.map(tradeKey),
    [sortedTrades],
  );
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = !allSelected && allKeys.some((k) => selected.has(k));

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(allKeys) : new Set());
  };

  const toggleOne = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const reset = () => {
    setPreview(null);
    setSelected(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectedCount = selected.size;

  // ──────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Step 1 — file picker */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudUpload className="size-4 text-primary" />
            Tải lên báo cáo HTML
          </CardTitle>
          <CardDescription>
            Kéo-thả hoặc chọn tệp <code className="font-mono">.html</code> /{" "}
            <code className="font-mono">.htm</code> xuất từ MetaTrader 4 hoặc 5.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card/40 px-6 py-10 text-center transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : "hover:border-primary/50",
            )}
          >
            {previewMut.isPending ? (
              <>
                <Loader2 className="size-6 animate-spin text-primary" />
                <div className="text-sm text-muted-foreground">
                  Đang phân tích tệp…
                </div>
              </>
            ) : (
              <>
                <Inbox className="size-6 text-primary" />
                <div className="text-sm font-medium">
                  Kéo thả tệp vào đây hoặc bấm để chọn
                </div>
                <div className="text-xs text-muted-foreground">
                  Tối đa 5MB · chỉ chấp nhận HTML
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          <details className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              Cách xuất báo cáo từ MT4 / MT5
            </summary>
            <ul className="mt-3 space-y-2 pl-4 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">MT4:</span>{" "}
                Tab <em>Account History</em> → chuột phải → <em>Save as Detailed Report</em> → chọn nơi lưu file{" "}
                <code className="font-mono">.htm</code>.
              </li>
              <li>
                <span className="font-medium text-foreground">MT5:</span>{" "}
                Tab <em>Account History</em> → chuột phải → <em>Report</em> →{" "}
                <em>HTML</em>.
              </li>
              <li>
                Báo cáo sẽ tự động được phân loại MT4 hoặc MT5. Mọi
                lệnh được tạo ra ở trạng thái <em>CLOSED</em>; bạn có thể
                bổ sung ảnh chụp / ghi chú / cảm xúc sau bằng trang chi
                tiết lệnh.
              </li>
            </ul>
          </details>
        </CardContent>
      </Card>

      {/* Step 2 — preview */}
      {preview && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-4 text-bullish" />
                Xem trước
                <Badge
                  variant="outline"
                  className={cn(
                    "ml-1 border-transparent",
                    preview.broker === "MT4"
                      ? "bg-info/10 text-info"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {preview.broker}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Đã đọc <span className="font-medium">{preview.parsed}</span>{" "}
                lệnh
                {preview.skipped > 0 && (
                  <>
                    , bỏ qua{" "}
                    <span className="font-medium">{preview.skipped}</span> dòng
                    không hợp lệ
                  </>
                )}
                .
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={reset}>
                <RefreshCw className="size-4" />
                Chọn tệp khác
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Tài khoản
                </Label>
                <Select
                  value={accountId}
                  onValueChange={(v) => v && setAccountId(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_ACCOUNT}>
                      Không gán tài khoản
                    </SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 md:col-span-2">
                <div className="space-y-0.5">
                  <Label className="text-sm">Bỏ qua lệnh trùng</Label>
                  <p className="text-xs text-muted-foreground">
                    So khớp theo symbol + thời gian mở + lot + hướng.
                  </p>
                </div>
                <Switch
                  checked={dedupe}
                  onCheckedChange={(v) => setDedupe(Boolean(v))}
                />
              </div>
            </div>

            {sortedTrades.length === 0 ? (
              <EmptyState
                icon={FileWarning}
                title="Không có lệnh nào hợp lệ"
                description="Có thể tệp đã trống hoặc chỉ chứa các dòng balance / credit."
              />
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={someSelected}
                          onCheckedChange={(v) => toggleAll(Boolean(v))}
                          aria-label="Chọn tất cả"
                        />
                      </TableHead>
                      <SortableHead
                        label="Ticket"
                        sortKey="ticket"
                        sort={sort}
                        onClick={toggleSort}
                      />
                      <SortableHead
                        label="Symbol"
                        sortKey="symbol"
                        sort={sort}
                        onClick={toggleSort}
                      />
                      <SortableHead
                        label="Hướng"
                        sortKey="direction"
                        sort={sort}
                        onClick={toggleSort}
                      />
                      <SortableHead
                        label="Lot"
                        sortKey="size"
                        sort={sort}
                        onClick={toggleSort}
                        align="right"
                      />
                      <SortableHead
                        label="Mở"
                        sortKey="openedAt"
                        sort={sort}
                        onClick={toggleSort}
                      />
                      <SortableHead
                        label="Đóng"
                        sortKey="closedAt"
                        sort={sort}
                        onClick={toggleSort}
                      />
                      <SortableHead
                        label="P/L"
                        sortKey="pnl"
                        sort={sort}
                        onClick={toggleSort}
                        align="right"
                      />
                      <SortableHead
                        label="Thời gian giữ"
                        sortKey="duration"
                        sort={sort}
                        onClick={toggleSort}
                        align="right"
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTrades.map((t) => {
                      const k = tradeKey(t);
                      const checked = selected.has(k);
                      const isLong = t.direction === "LONG";
                      return (
                        <TableRow key={k} data-state={checked ? "selected" : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                toggleOne(k, Boolean(v))
                              }
                              aria-label={`Chọn ticket ${t.externalTicket}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {t.externalTicket}
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-sm font-medium">
                              {t.symbol}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t.market}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "border-transparent",
                                isLong
                                  ? "bg-bullish/10 text-bullish"
                                  : "bg-bearish/10 text-bearish",
                              )}
                            >
                              {t.direction}
                            </Badge>
                          </TableCell>
                          <TableCell className="num text-right text-sm">
                            {fmtNum(t.lotSize, 2)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {format(parseISO(t.openedAt), "yyyy-MM-dd HH:mm")}
                          </TableCell>
                          <TableCell className="text-xs">
                            {format(parseISO(t.closedAt), "yyyy-MM-dd HH:mm")}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "num text-right text-sm font-medium",
                              t.pnl > 0 && "text-bullish",
                              t.pnl < 0 && "text-bearish",
                            )}
                          >
                            {`${t.pnl > 0 ? "+" : ""}${fmtNum(t.pnl)}`}
                          </TableCell>
                          <TableCell className="num text-right text-xs text-muted-foreground">
                            {fmtDuration(durationMs(t))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="text-sm text-muted-foreground">
                Đã chọn{" "}
                <span className="font-medium text-foreground">
                  {selectedCount}
                </span>{" "}
                / {sortedTrades.length} lệnh.
              </div>
              <Button
                onClick={() => commitMut.mutate()}
                disabled={selectedCount === 0 || commitMut.isPending}
              >
                {commitMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {commitMut.isPending
                  ? "Đang nhập…"
                  : `Nhập ${selectedCount} lệnh`}
              </Button>
            </div>

            {commitMut.data && commitMut.data.errors.length > 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
                <div className="font-medium">
                  {commitMut.data.errors.length} lệnh gặp lỗi:
                </div>
                <ul className="mt-1 list-disc pl-5">
                  {commitMut.data.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      <span className="font-mono">#{e.ticket}</span>:{" "}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SortableHead({
  label,
  sortKey,
  sort,
  onClick,
  align,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  const isActive = sort.key === sortKey;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition-colors",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        {isActive ? (
          <span aria-hidden>{sort.dir === "asc" ? "↑" : "↓"}</span>
        ) : null}
      </button>
    </TableHead>
  );
}
