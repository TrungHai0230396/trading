import Link from "next/link";
import { ArrowLeft, ListChecks } from "lucide-react";

import { auth } from "@/lib/auth";
import { getSystemStats, type SystemStat } from "@/lib/journal/system-stats";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(0)}%`;
}

export default async function SystemAnalysisPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const { currency, systems } = await getSystemStats(userId);

  const money = (n: number) =>
    `${n > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)} ${currency}`;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Phân tích hệ thống"
        description="Hiệu suất từng hệ thống giao dịch — dựa trên lệnh đã đóng (số liệu bạn nhập)."
        actions={
          <Button variant="outline" render={<Link href="/journal" />}>
            <ArrowLeft className="size-4" />
            Về Nhật ký
          </Button>
        }
      />

      {systems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Chưa có lệnh nào. Tạo lệnh và gắn hệ thống ở form Nhật ký để xem phân
            tích tại đây.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {systems.map((s) => (
            <SystemCard key={s.systemId ?? "__none__"} s={s} money={money} />
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-md bg-muted/40 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "num mt-0.5 text-sm font-medium",
          tone === "up" && "text-bullish",
          tone === "down" && "text-bearish",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SystemCard({
  s,
  money,
}: {
  s: SystemStat;
  money: (n: number) => string;
}) {
  const pf =
    s.profitFactor === null ? "∞" : s.profitFactor.toFixed(2);
  const pnlTone = s.totalPnl > 0 ? "up" : s.totalPnl < 0 ? "down" : undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {s.name}
            {s.archived ? (
              <Badge variant="outline" className="text-[10px]">
                đã lưu trữ
              </Badge>
            ) : null}
          </CardTitle>
          <div className="flex gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">
              {s.closed} đã đóng
            </span>
            <span className="rounded bg-info/10 px-1.5 py-0.5 text-info">
              {s.open} đang mở
            </span>
            <span className="rounded border border-dashed px-1.5 py-0.5">
              {s.pending} chờ khớp
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {s.closed === 0 ? (
          <p className="text-xs text-muted-foreground">
            Chưa có lệnh đã đóng — đóng lệnh và nhập P/L để có thống kê.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Metric
              label="Tỷ lệ thắng"
              value={pct(s.winRate)}
              tone={s.winRate >= 0.5 ? "up" : "down"}
            />
            <Metric label="Tổng P/L" value={money(s.totalPnl)} tone={pnlTone} />
            <Metric
              label="R trung bình"
              value={`${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R`}
              tone={s.avgR > 0 ? "up" : s.avgR < 0 ? "down" : undefined}
            />
            <Metric label="Profit factor" value={pf} />
            <Metric label="Lời lớn nhất" value={money(s.bestPnl)} tone="up" />
            <Metric label="Lỗ lớn nhất" value={money(s.worstPnl)} tone="down" />
          </div>
        )}

        {/* Checklist adherence */}
        {s.checkedTrades > 0 ? (
          <div className="rounded-md border bg-card/40 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <ListChecks className="size-3.5 text-primary" />
              Tuân thủ checklist
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Metric
                label="Theo đúng checklist"
                value={`${pct(s.adherenceRate)} (${s.followed}/${s.checkedTrades})`}
                tone={s.adherenceRate >= 0.8 ? "up" : undefined}
              />
              <Metric
                label="Win-rate khi THEO đúng"
                value={pct(s.winRateFollowed)}
                tone="up"
              />
              <Metric
                label="Win-rate khi KHÔNG theo"
                value={pct(s.winRateNotFollowed)}
                tone="down"
              />
            </div>
            {s.winRateFollowed !== null && s.winRateNotFollowed !== null ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {s.winRateFollowed > s.winRateNotFollowed
                  ? "→ Theo đúng checklist cho win-rate cao hơn — kỷ luật có lợi."
                  : s.winRateFollowed < s.winRateNotFollowed
                    ? "→ Lạ: không theo checklist lại thắng nhiều hơn. Xem lại các mục trong checklist."
                    : "→ Chưa đủ khác biệt để kết luận."}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
