"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ListChecks, Star } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  SerializedTradingSystem,
  SystemCheckSnapshot,
  TradingSystemListResponse,
} from "@/lib/trading-systems/types";

const NONE = "__none__";

export type TradingSystemCardState = {
  tradingSystemId: string | null;
  systemChecks: SystemCheckSnapshot[];
};

/**
 * In-form card. Shows a Select to pick a system + the system's checklist.
 * - "new" mode: auto-selects the user's default system on first load.
 * - "edit" mode: shows the snapshot stored on the trade (still editable).
 *
 * State is fully controlled by the parent form (so the parent can include
 * the values in its submit payload). The card only updates the parent via
 * onChange.
 */
export function TradingSystemCard({
  mode,
  initialTradingSystemId,
  initialSystemChecks,
  state,
  onChange,
}: {
  mode: "new" | "edit";
  initialTradingSystemId: string | null;
  initialSystemChecks: SystemCheckSnapshot[];
  state: TradingSystemCardState;
  onChange: (next: TradingSystemCardState) => void;
}) {
  const list = useQuery<TradingSystemListResponse>({
    queryKey: ["trading-systems"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/trading-systems", { signal });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? "Không tải được danh sách hệ thống");
      }
      return (await res.json()) as TradingSystemListResponse;
    },
  });

  // ── Auto-select default for new mode (once) ─────────────────────────
  const autoSelectedRef = React.useRef(false);
  React.useEffect(() => {
    if (autoSelectedRef.current) return;
    if (mode !== "new") return;
    if (state.tradingSystemId) return;
    if (!list.data) return;
    const def = list.data.items.find((s) => s.isDefault);
    if (!def) {
      autoSelectedRef.current = true;
      return;
    }
    autoSelectedRef.current = true;
    onChange({
      tradingSystemId: def.id,
      systemChecks: def.items.map((it) => ({
        label: it.label,
        required: it.required,
        checked: false,
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, list.data]);

  // ── For edit mode: if a tradingSystemId is set and the system still
  // exists in our list but our checks come from a stale snapshot with
  // different items, we still show the snapshot. The snapshot is the
  // source of truth — newer template changes never alter past trades.
  // ────────────────────────────────────────────────────────────────────

  const handleSelect = (raw: string | null) => {
    if (!raw || raw === NONE) {
      onChange({ tradingSystemId: null, systemChecks: [] });
      return;
    }
    const picked = list.data?.items.find((s) => s.id === raw);
    if (!picked) {
      onChange({ tradingSystemId: raw, systemChecks: [] });
      return;
    }
    // Switching system: reset snapshot from the template, preserve any
    // checks for labels that happen to be identical (so users typing a
    // similar checklist don't lose progress).
    const prevByLabel = new Map(
      state.systemChecks.map((c) => [c.label, c.checked] as const),
    );
    onChange({
      tradingSystemId: picked.id,
      systemChecks: picked.items.map((it) => ({
        label: it.label,
        required: it.required,
        checked: prevByLabel.get(it.label) ?? false,
      })),
    });
  };

  const toggle = (idx: number, next: boolean) => {
    const arr = state.systemChecks.slice();
    if (!arr[idx]) return;
    arr[idx] = { ...arr[idx], checked: next };
    onChange({ tradingSystemId: state.tradingSystemId, systemChecks: arr });
  };

  const selectedId = state.tradingSystemId ?? NONE;
  const systems = list.data?.items ?? [];
  const selectedSystem: SerializedTradingSystem | undefined = systems.find(
    (s) => s.id === state.tradingSystemId,
  );

  // What we actually render: the snapshot in state. The select is just for
  // switching systems / clearing.
  const visibleChecks = state.systemChecks;
  const totalRequired = visibleChecks.filter((c) => c.required).length;
  const checkedRequired = visibleChecks.filter(
    (c) => c.required && c.checked,
  ).length;
  const totalAll = visibleChecks.length;
  const checkedAll = visibleChecks.filter((c) => c.checked).length;

  // For when the snapshot references a deleted/archived system (id set but
  // not in our list): we still show "Hệ thống đã xoá" as a label.
  const snapshotOnly =
    state.tradingSystemId !== null && !selectedSystem && !list.isLoading;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="size-4 text-primary" />
            Hệ thống giao dịch
          </CardTitle>
          <CardDescription>
            Tick checklist trước khi vào lệnh — giảm FOMO/revenge trade.
          </CardDescription>
        </div>
        {totalAll > 0 ? (
          <div className="text-right text-xs">
            <div className="num font-semibold text-foreground">
              {checkedAll}/{totalAll}
            </div>
            {totalRequired > 0 ? (
              <div className="text-muted-foreground">
                {checkedRequired}/{totalRequired} bắt buộc
              </div>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Chọn hệ thống</label>
          <Select value={selectedId} onValueChange={handleSelect}>
            <SelectTrigger className="w-full">
              {/* base-ui Select.Value hiển thị value thô (cuid) trừ khi
                  ta đưa function children — ánh xạ id → tên hệ thống. */}
              <SelectValue placeholder="(Không dùng hệ thống)">
                {(value: string | null) => {
                  if (!value || value === NONE)
                    return "(Không dùng hệ thống)";
                  const sys = systems.find((s) => s.id === value);
                  if (sys) {
                    return (
                      <span className="flex items-center gap-1.5">
                        <span>{sys.name}</span>
                        {sys.isDefault ? (
                          <span className="text-xs text-muted-foreground">
                            • mặc định
                          </span>
                        ) : null}
                      </span>
                    );
                  }
                  // System exists on the trade snapshot but not in our list
                  // (archived or deleted).
                  return (
                    <span className="text-muted-foreground">
                      Hệ thống đã xoá
                    </span>
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>(Không dùng hệ thống)</SelectItem>
              {systems.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-1.5">
                    <span>{s.name}</span>
                    {s.isDefault ? (
                      <span className="text-xs text-muted-foreground">
                        • mặc định
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
              {snapshotOnly ? (
                <SelectItem value={state.tradingSystemId as string} disabled>
                  Hệ thống đã xoá
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>

        {list.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : visibleChecks.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            {selectedId === NONE
              ? "Để trống nếu lệnh tự phát / scalp nhanh."
              : "Hệ thống này chưa có mục checklist nào."}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {visibleChecks.map((c, idx) => (
              <li key={idx}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border p-2 transition",
                    c.checked
                      ? "border-bullish/30 bg-bullish/5"
                      : c.required
                        ? "border-amber-400/40 bg-amber-400/5"
                        : "border-border bg-card/40",
                  )}
                >
                  <Checkbox
                    checked={c.checked}
                    onCheckedChange={(v) => toggle(idx, Boolean(v))}
                    className="mt-0.5"
                  />
                  <span className="flex-1 text-sm">{c.label}</span>
                  {c.required ? (
                    <Star
                      className={cn(
                        "size-4 shrink-0",
                        c.checked
                          ? "text-muted-foreground"
                          : "fill-amber-400 text-amber-500",
                      )}
                      aria-label="Bắt buộc"
                    />
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Quick predicate the parent form can call on submit to decide whether
 * to show a warn dialog.
 */
export function countUnmetRequired(checks: SystemCheckSnapshot[]): number {
  let n = 0;
  for (const c of checks) if (c.required && !c.checked) n++;
  return n;
}

/** Stable helper so the parent doesn't have to import the schema. */
export function makeInitialChecksFor(
  snapshot: SystemCheckSnapshot[] | null,
): SystemCheckSnapshot[] {
  return snapshot
    ? snapshot.map((c) => ({
        label: c.label,
        required: Boolean(c.required),
        checked: Boolean(c.checked),
      }))
    : [];
}
