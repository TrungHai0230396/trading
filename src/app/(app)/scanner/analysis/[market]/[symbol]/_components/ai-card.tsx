"use client";

import * as React from "react";
import { Sparkles, AlertTriangle, RefreshCw } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * AI narrative card — explicit-trigger version.
 *
 * Previously this card auto-ran Gemini on every page mount. That:
 *   1. Burned quota for coins users only glance at
 *   2. Made the page fragile to 503 outages
 *   3. Added 5-15s of dead time to the perceived page load
 *
 * Now the user clicks "Phân tích AI" to trigger; the card transitions
 * through idle → loading → success/error states locally without a
 * full page reload.
 */

type Narrative = {
  narrative: string;
  entryWhen: string;
  exitWhen: string;
  invalidation: string;
  watchPoints: string[];
  aiModel: string;
  generatedAt: string;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: Narrative }
  | { kind: "error"; message: string };

export function AiCard({
  market,
  symbol,
}: {
  market: "CRYPTO" | "FOREX";
  symbol: string;
}) {
  const [state, setState] = React.useState<State>({ kind: "idle" });

  const run = React.useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const url = `/api/scanner/analysis/${market.toLowerCase()}/${symbol}/ai`;
      const res = await fetch(url, { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | (Narrative & { error?: undefined })
        | { error: string }
        | null;
      if (!res.ok || !data || "error" in data) {
        const msg =
          data && "error" in data && data.error
            ? data.error
            : `HTTP ${res.status}`;
        setState({ kind: "error", message: msg });
        return;
      }
      setState({ kind: "success", data: data as Narrative });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [market, symbol]);

  if (state.kind === "idle") return <IdleCard onRun={run} />;
  if (state.kind === "loading") return <LoadingCard />;
  if (state.kind === "error")
    return <ErrorCard message={state.message} onRetry={run} />;
  return <SuccessCard data={state.data} onRerun={run} />;
}

// ── States ────────────────────────────────────────────────────────────

function IdleCard({ onRun }: { onRun: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          Phân tích AI
        </CardTitle>
        <CardDescription>
          Bấm để Gemini tổng hợp tín hiệu kỹ thuật + tin tức + plan đã tính
          thành 1 đoạn đánh giá tiếng Việt + điều kiện vào/thoát/vô hiệu.
          Mất ~5-15 giây.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onRun}>
          <Sparkles className="size-4" />
          Phân tích AI
        </Button>
      </CardContent>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 animate-pulse text-primary" />
          Phân tích AI
        </CardTitle>
        <CardDescription>Đang phân tích, ~5-15 giây…</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-10/12" />
        <Skeleton className="h-3 w-9/12" />
      </CardContent>
    </Card>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const isBudget = /429|quota|giới hạn ai|hết lượt|resource.?exhausted/i.test(
    message,
  );
  const isOverload = /quá tải|overload|unavail|503|high demand/i.test(message);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          Phân tích AI
        </CardTitle>
        <CardDescription>
          {isBudget
            ? "Đã chạm giới hạn AI (theo giờ/ngày). Quay lại sau nhé — phần kế hoạch & tín hiệu phía trên không bị ảnh hưởng."
            : isOverload
              ? "Gemini đang quá tải. Chờ vài giây rồi bấm Thử lại."
              : "Có lỗi khi gọi Gemini. Xem chi tiết bên dưới rồi thử lại."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span className="break-all">{message}</span>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-4" />
          Thử lại
        </Button>
      </CardContent>
    </Card>
  );
}

function SuccessCard({
  data,
  onRerun,
}: {
  data: Narrative;
  onRerun: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              Phân tích AI
            </CardTitle>
            <CardDescription>
              Đánh giá định tính, ghi chú bằng số. Không phải khuyến nghị
              đầu tư.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onRerun} title="Chạy lại">
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">{data.narrative}</p>

        <div className="grid gap-3 sm:grid-cols-3">
          <NarrativeBlock label="Vào lệnh khi" body={data.entryWhen} />
          <NarrativeBlock label="Thoát sớm khi" body={data.exitWhen} />
          <NarrativeBlock label="Kế hoạch bị vô hiệu khi" body={data.invalidation} />
        </div>

        {data.watchPoints.length > 0 ? (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              Cần theo dõi 24-72h:
            </div>
            <ul className="space-y-1 text-sm">
              {data.watchPoints.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          Model: <span className="font-mono">{data.aiModel}</span> ·{" "}
          {new Date(data.generatedAt).toLocaleString("vi-VN", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </p>
      </CardContent>
    </Card>
  );
}

function NarrativeBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="space-y-1 rounded-md border bg-card/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <p className="text-xs leading-relaxed">{body}</p>
    </div>
  );
}
