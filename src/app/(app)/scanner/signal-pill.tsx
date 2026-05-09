import { cn } from "@/lib/utils";

export type SignalLike = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";

const LABELS: Record<SignalLike, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Trung tính",
  MIXED: "Hỗn hợp",
};

const STYLES: Record<SignalLike, string> = {
  BULLISH: "bg-bullish/15 text-bullish ring-1 ring-bullish/30",
  BEARISH: "bg-bearish/15 text-bearish ring-1 ring-bearish/30",
  NEUTRAL: "bg-muted text-muted-foreground ring-1 ring-border",
  MIXED: "bg-warning/15 text-warning ring-1 ring-warning/30",
};

export function SignalPill({
  signal,
  className,
  compact,
}: {
  signal: SignalLike;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium",
        compact ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        STYLES[signal],
        className,
      )}
    >
      {LABELS[signal]}
    </span>
  );
}

export function ScoreBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  // Color band: < 40 bearish, 40..60 neutral/warning, > 60 bullish.
  const tone =
    v >= 60
      ? "bg-bullish"
      : v <= 40
        ? "bg-bearish"
        : "bg-warning";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", tone)}
          style={{ width: `${v}%` }}
        />
      </div>
      <span className="num text-xs tabular-nums text-muted-foreground">
        {v.toFixed(1)}
      </span>
    </div>
  );
}
