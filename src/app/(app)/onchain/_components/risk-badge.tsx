import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  low: "Risk thấp",
  medium: "Risk trung bình",
  high: "Risk cao",
};

const STYLES: Record<string, string> = {
  low: "bg-bullish/15 text-bullish border-bullish/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  high: "bg-bearish/15 text-bearish border-bearish/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

export function RiskBadge({ level }: { level: string | null | undefined }) {
  const key = level && STYLES[level] ? level : "unknown";
  const label = LABELS[key] ?? "Chưa xác định";
  return (
    <Badge
      variant="outline"
      className={cn("border px-2 py-0.5 text-xs font-medium", STYLES[key])}
    >
      {label}
    </Badge>
  );
}
