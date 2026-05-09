"use client";

import * as React from "react";
import {
  ArrowRightLeft,
  Droplets,
  Flag,
  Footprints,
  Sparkles,
  Users,
  ChevronDown,
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
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { RiskBadge } from "./risk-badge";

type Insight = {
  type: "flow" | "holders" | "liquidity" | "behavior" | "flag" | string;
  label: string;
  detail: string;
};

export type OnchainReportLike = {
  id: string;
  chain: string;
  targetType: string;
  target: string;
  summary: string | null;
  riskLevel: string | null;
  insights: unknown;
  rawData: unknown;
  aiModel: string | null;
  createdAt: string | Date;
};

const INSIGHT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  flow: ArrowRightLeft,
  holders: Users,
  liquidity: Droplets,
  behavior: Footprints,
  flag: Flag,
};

const TARGET_LABELS: Record<string, string> = {
  WALLET: "Wallet",
  TOKEN: "Token",
  TRANSACTION: "Transaction",
};

function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function parseInsights(raw: unknown): Insight[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const obj = r as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "flag";
      const label = typeof obj.label === "string" ? obj.label : "";
      const detail = typeof obj.detail === "string" ? obj.detail : "";
      if (!label && !detail) return null;
      return { type, label, detail } as Insight;
    })
    .filter((x): x is Insight => x !== null);
}

export function ReportDisplay({
  report,
  className,
}: {
  report: OnchainReportLike;
  className?: string;
}) {
  const insights = React.useMemo(
    () => parseInsights(report.insights),
    [report.insights],
  );

  const created =
    typeof report.createdAt === "string"
      ? new Date(report.createdAt)
      : report.createdAt;

  return (
    <div className={cn("space-y-4", className)}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" />
                Báo cáo on-chain
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono uppercase">
                  {report.chain}
                </Badge>
                <Badge variant="outline">
                  {TARGET_LABELS[report.targetType] ?? report.targetType}
                </Badge>
                <span
                  className="num truncate text-xs text-muted-foreground"
                  title={report.target}
                >
                  {shortAddress(report.target)}
                </span>
              </CardDescription>
            </div>
            <RiskBadge level={report.riskLevel} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-foreground/90">
            {report.summary || "Chưa có summary."}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{created.toLocaleString("vi-VN")}</span>
            {report.aiModel ? (
              <>
                <span>·</span>
                <span className="font-mono">{report.aiModel}</span>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Insight</CardTitle>
          <CardDescription>
            Các phát hiện chính do AI tổng hợp từ dữ liệu thô.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Không có insight cụ thể.
            </p>
          ) : (
            <ul className="space-y-3">
              {insights.map((it, i) => {
                const Icon = INSIGHT_ICONS[it.type] ?? Flag;
                return (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium leading-tight">
                        {it.label}
                      </p>
                      {it.detail ? (
                        <p className="text-xs text-muted-foreground">
                          {it.detail}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <RawDataAccordion raw={report.rawData} />
    </div>
  );
}

function RawDataAccordion({ raw }: { raw: unknown }) {
  const [open, setOpen] = React.useState(false);
  const text = React.useMemo(() => {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }, [raw]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <Button
          type="button"
          variant="ghost"
          className="-mx-2 h-9 justify-between px-2"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            Dữ liệu thô (raw)
            <Separator orientation="vertical" className="h-4" />
            <span className="text-xs font-normal text-muted-foreground">
              JSON từ explorer
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </CardHeader>
      {open ? (
        <CardContent>
          <pre className="num max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
            {text}
          </pre>
        </CardContent>
      ) : null}
    </Card>
  );
}
