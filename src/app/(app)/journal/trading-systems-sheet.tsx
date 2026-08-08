"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ListChecks,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  SerializedTradingSystem,
  TradingSystemListResponse,
} from "@/lib/trading-systems/types";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

type DraftItem = {
  /** Existing id when editing; undefined for newly added rows. */
  id?: string;
  /** Stable client-side key — survives the round trip even if id changes. */
  key: string;
  label: string;
  required: boolean;
};

type Draft = {
  name: string;
  notes: string;
  isDefault: boolean;
  items: DraftItem[];
};

const EMPTY_DRAFT: Draft = {
  name: "",
  notes: "",
  isDefault: false,
  items: [],
};

let keyCounter = 0;
const nextKey = () => `new-${Date.now()}-${keyCounter++}`;

function fromSystem(s: SerializedTradingSystem): Draft {
  return {
    name: s.name,
    notes: s.notes ?? "",
    isDefault: s.isDefault,
    items: s.items.map((it) => ({
      id: it.id,
      key: it.id,
      label: it.label,
      required: it.required,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Sheet
// ──────────────────────────────────────────────────────────────────────

export function TradingSystemsSheet({
  trigger,
}: {
  /**
   * Optional replacement for the default "Hệ thống" button, so the same sheet
   * can be opened from inside the trade form — a user picking a system there
   * shouldn't have to abandon a half-filled trade just to create one. Creating
   * here invalidates ["trading-systems"], the same key the form's select reads,
   * so the new system appears in the dropdown straight away.
   */
  trigger?: React.ReactElement;
} = {}) {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<"list" | "edit">("list");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const queryClient = useQueryClient();

  const list = useQuery<TradingSystemListResponse>({
    queryKey: ["trading-systems"],
    enabled: open,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/trading-systems", { signal });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? "Không tải được danh sách hệ thống");
      }
      return (await res.json()) as TradingSystemListResponse;
    },
  });

  // Reset to list view whenever the sheet is closed.
  React.useEffect(() => {
    if (!open) {
      setView("list");
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: draft.name.trim(),
        notes: draft.notes.trim() ? draft.notes.trim() : undefined,
        isDefault: draft.isDefault,
        items: draft.items
          .filter((it) => it.label.trim().length > 0)
          .map((it) => ({
            ...(it.id ? { id: it.id } : {}),
            label: it.label.trim(),
            required: it.required,
          })),
      };
      const url =
        editingId === null
          ? "/api/trading-systems"
          : `/api/trading-systems/${editingId}`;
      const method = editingId === null ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as
        | SerializedTradingSystem
        | { error?: string }
        | null;
      if (!res.ok) {
        const msg =
          data && "error" in data ? data.error : "Lưu hệ thống thất bại";
        throw new Error(msg ?? "Lưu hệ thống thất bại");
      }
      return data as SerializedTradingSystem;
    },
    onSuccess: () => {
      toast.success(editingId === null ? "Đã tạo hệ thống" : "Đã cập nhật");
      queryClient.invalidateQueries({ queryKey: ["trading-systems"] });
      setView("list");
      setEditingId(null);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Lỗi không xác định"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/trading-systems/${id}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error ?? "Xoá thất bại");
    },
    onSuccess: () => {
      toast.success("Đã xoá hệ thống");
      queryClient.invalidateQueries({ queryKey: ["trading-systems"] });
      setConfirmDeleteId(null);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Lỗi không xác định"),
  });

  // ── Draft helpers ────────────────────────────────────────────────
  const beginCreate = () => {
    setDraft({ ...EMPTY_DRAFT, items: [{ key: nextKey(), label: "", required: false }] });
    setEditingId(null);
    setView("edit");
  };
  const beginEdit = (s: SerializedTradingSystem) => {
    setDraft(fromSystem(s));
    setEditingId(s.id);
    setView("edit");
  };

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    }));
  const addItem = () =>
    setDraft((d) => ({
      ...d,
      items: [...d.items, { key: nextKey(), label: "", required: false }],
    }));
  const removeItem = (key: string) =>
    setDraft((d) => ({
      ...d,
      items: d.items.filter((it) => it.key !== key),
    }));
  const moveItem = (key: string, delta: -1 | 1) =>
    setDraft((d) => {
      const idx = d.items.findIndex((it) => it.key === key);
      if (idx === -1) return d;
      const swap = idx + delta;
      if (swap < 0 || swap >= d.items.length) return d;
      const next = d.items.slice();
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return { ...d, items: next };
    });

  const draftValid =
    draft.name.trim().length > 0 &&
    draft.items.some((it) => it.label.trim().length > 0);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            trigger ?? (
              <Button variant="outline">
                <ListChecks className="size-4" />
                Hệ thống
              </Button>
            )
          }
        />
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
          {view === "list" ? (
            <ListView
              loading={list.isLoading}
              error={list.error instanceof Error ? list.error.message : null}
              systems={list.data?.items ?? []}
              onCreate={beginCreate}
              onEdit={beginEdit}
              onAskDelete={setConfirmDeleteId}
            />
          ) : (
            <EditView
              isNew={editingId === null}
              draft={draft}
              setDraft={setDraft}
              onBack={() => {
                setView("list");
                setEditingId(null);
              }}
              onSave={() => saveMutation.mutate()}
              saving={saveMutation.isPending}
              canSave={draftValid && !saveMutation.isPending}
              addItem={addItem}
              updateItem={updateItem}
              removeItem={removeItem}
              moveItem={moveItem}
            />
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteId(null);
        }}
        onConfirm={() => {
          if (confirmDeleteId) deleteMutation.mutate(confirmDeleteId);
        }}
        pending={deleteMutation.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// List view
// ──────────────────────────────────────────────────────────────────────

function ListView({
  loading,
  error,
  systems,
  onCreate,
  onEdit,
  onAskDelete,
}: {
  loading: boolean;
  error: string | null;
  systems: SerializedTradingSystem[];
  onCreate: () => void;
  onEdit: (s: SerializedTradingSystem) => void;
  onAskDelete: (id: string) => void;
}) {
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          Hệ thống giao dịch
        </SheetTitle>
        <SheetDescription>
          Checklist trước khi vào lệnh. Tick từng mục để tránh phá kỉ luật.
        </SheetDescription>
      </SheetHeader>

      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs text-muted-foreground">
          {loading ? "Đang tải…" : `${systems.length} hệ thống`}
        </span>
        <Button size="sm" onClick={onCreate} disabled={loading}>
          <Plus className="size-4" />
          Tạo mới
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : systems.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Chưa có hệ thống nào. Bấm “Tạo mới” để bắt đầu.
          </div>
        ) : (
          <div className="space-y-2">
            {systems.map((s) => (
              <SystemRow
                key={s.id}
                system={s}
                onEdit={() => onEdit(s)}
                onAskDelete={() => onAskDelete(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SystemRow({
  system,
  onEdit,
  onAskDelete,
}: {
  system: SerializedTradingSystem;
  onEdit: () => void;
  onAskDelete: () => void;
}) {
  const requiredCount = system.items.filter((it) => it.required).length;
  return (
    <div
      className="group flex w-full items-start gap-3 rounded-lg border bg-card/30 p-3 transition hover:bg-card/60"
    >
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-1 flex-col items-start gap-1 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{system.name}</span>
          {system.isDefault ? (
            <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300">
              <Star className="size-3" />
              Mặc định
            </Badge>
          ) : null}
        </div>
        {system.notes ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {system.notes}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{system.items.length} mục</span>
          {requiredCount > 0 ? (
            <span className="flex items-center gap-1">
              <span>·</span>
              <Star className="size-3" />
              {requiredCount} bắt buộc
            </span>
          ) : null}
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="opacity-0 transition group-hover:opacity-100"
        onClick={onAskDelete}
        aria-label={`Xoá ${system.name}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit view
// ──────────────────────────────────────────────────────────────────────

function EditView({
  isNew,
  draft,
  setDraft,
  onBack,
  onSave,
  saving,
  canSave,
  addItem,
  updateItem,
  removeItem,
  moveItem,
}: {
  isNew: boolean;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  addItem: () => void;
  updateItem: (key: string, patch: Partial<DraftItem>) => void;
  removeItem: (key: string) => void;
  moveItem: (key: string, delta: -1 | 1) => void;
}) {
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Quay lại">
            <ChevronLeft className="size-4" />
          </Button>
          <SheetTitle>{isNew ? "Tạo hệ thống mới" : "Sửa hệ thống"}</SheetTitle>
        </div>
        <SheetDescription>
          Đặt tên, mô tả ngắn và liệt kê các mục cần check trước khi vào lệnh.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Tên *</label>
          <Input
            value={draft.name}
            onChange={(e) =>
              setDraft((d) => ({ ...d, name: e.target.value }))
            }
            placeholder="Breakout H1, Trend D1…"
            maxLength={80}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Mô tả</label>
          <Textarea
            value={draft.notes}
            onChange={(e) =>
              setDraft((d) => ({ ...d, notes: e.target.value }))
            }
            placeholder="Mô tả ngắn về phong cách / setup của hệ thống này."
            rows={2}
            maxLength={2000}
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={draft.isDefault}
            onCheckedChange={(v) =>
              setDraft((d) => ({ ...d, isDefault: Boolean(v) }))
            }
          />
          <span>
            <span className="font-medium">Đặt làm mặc định</span>
            <p className="text-xs text-muted-foreground">
              Tự chọn hệ thống này khi tạo lệnh mới.
            </p>
          </span>
        </label>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Checklist</h3>
            <Button size="sm" variant="outline" onClick={addItem}>
              <Plus className="size-4" />
              Thêm mục
            </Button>
          </div>
          {draft.items.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              Chưa có mục nào. Bấm “Thêm mục” để bắt đầu.
            </div>
          ) : (
            <ul className="space-y-2">
              {draft.items.map((it, idx) => (
                <li
                  key={it.key}
                  className="flex items-start gap-2 rounded-md border bg-card/40 p-2"
                >
                  <div className="flex flex-col gap-0.5 pt-0.5">
                    <button
                      type="button"
                      className="text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                      disabled={idx === 0}
                      onClick={() => moveItem(it.key, -1)}
                      aria-label="Lên"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                      disabled={idx === draft.items.length - 1}
                      onClick={() => moveItem(it.key, 1)}
                      aria-label="Xuống"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                  </div>
                  <Input
                    value={it.label}
                    onChange={(e) =>
                      updateItem(it.key, { label: e.target.value })
                    }
                    placeholder="Ví dụ: RR tối thiểu 1:2"
                    maxLength={255}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateItem(it.key, { required: !it.required })
                    }
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition",
                      it.required
                        ? "border-amber-400/50 bg-amber-400/10 text-amber-600 dark:text-amber-300"
                        : "border-input text-muted-foreground hover:bg-accent",
                    )}
                    aria-pressed={it.required}
                    title={it.required ? "Bắt buộc" : "Không bắt buộc"}
                  >
                    <Star className={cn("size-4", it.required && "fill-current")} />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeItem(it.key)}
                    aria-label="Xoá mục"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            <Star className="inline size-3" /> = bắt buộc tick mới khuyến nghị tạo lệnh.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t p-4">
        <SheetClose render={<Button variant="ghost">Đóng</Button>} />
        <Button onClick={onSave} disabled={!canSave}>
          {saving ? "Đang lưu…" : "Lưu"}
        </Button>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Delete confirm
// ──────────────────────────────────────────────────────────────────────

function ConfirmDeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xoá hệ thống này?</DialogTitle>
          <DialogDescription>
            Hệ thống sẽ được lưu trữ (archive). Các lệnh đã dùng vẫn giữ
            được lịch sử checklist; bạn chỉ không thể chọn hệ thống này khi
            tạo lệnh mới nữa.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Đang xoá…" : "Xoá"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
