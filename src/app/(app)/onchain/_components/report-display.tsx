"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Coins,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

      <HoldingsCard raw={report.rawData} />

      <RawDataAccordion raw={report.rawData} />
    </div>
  );
}

// ─────────────────────────────────────────── Holdings + buy/sell table

type HoldingLike = {
  contract: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  balance: string | null;
  incoming: { count: number; total: string };
  outgoing: { count: number; total: string };
};

function parseHoldings(raw: unknown): HoldingLike[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const arr = r.holdings;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((h) => {
      if (!h || typeof h !== "object") return null;
      const o = h as Record<string, unknown>;
      const inc = o.incoming as Record<string, unknown> | undefined;
      const out = o.outgoing as Record<string, unknown> | undefined;
      return {
        contract: typeof o.contract === "string" ? o.contract : "",
        symbol: typeof o.symbol === "string" ? o.symbol : null,
        name: typeof o.name === "string" ? o.name : null,
        decimals:
          typeof o.decimals === "number"
            ? o.decimals
            : typeof o.decimals === "string"
              ? Number(o.decimals)
              : null,
        balance: typeof o.balance === "string" ? o.balance : null,
        incoming: {
          count: typeof inc?.count === "number" ? inc.count : 0,
          total: typeof inc?.total === "string" ? inc.total : "0",
        },
        outgoing: {
          count: typeof out?.count === "number" ? out.count : 0,
          total: typeof out?.total === "string" ? out.total : "0",
        },
      } satisfies HoldingLike;
    })
    .filter((x): x is HoldingLike => x !== null && x.contract !== "");
}

/**
 * Render a raw token-unit integer ("123456789...") as a human-readable
 * number using BigInt division — we never go through Number for the
 * integer part to avoid losing precision for 18-decimal tokens.
 */
function formatUnits(raw: string, decimals: number | null): string {
  if (decimals === null || decimals < 0) return raw;
  try {
    const n = BigInt(raw);
    if (decimals === 0) return n.toString();
    // Avoid BigInt-literal syntax (`10n`) for ES2017 target compatibility.
    const denom = BigInt(10) ** BigInt(decimals);
    const whole = n / denom;
    const frac = n % denom;
    if (frac === BigInt(0)) return whole.toString();
    // Show up to 4 significant fractional digits, trimming trailing zeros.
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4);
    const trimmed = fracStr.replace(/0+$/, "");
    return trimmed ? `${whole.toString()}.${trimmed}` : whole.toString();
  } catch {
    return raw;
  }
}

function HoldingsCard({ raw }: { raw: unknown }) {
  const holdings = React.useMemo(() => parseHoldings(raw), [raw]);
  if (holdings.length === 0) return null;

  // Show those with positive balance first, then by activity.
  const sorted = [...holdings].sort((a, b) => {
    const aHas = a.balance && a.balance !== "0";
    const bHas = b.balance && b.balance !== "0";
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return (
      b.incoming.count + b.outgoing.count - (a.incoming.count + a.outgoing.count)
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Coins className="size-4 text-primary" />
          Token đang nắm giữ & hành vi mua/bán
        </CardTitle>
        <CardDescription>
          Balance hiện tại + thống kê chuyển vào/ra của ví trên cửa sổ gần đây
          (Etherscan V2, tối đa 50 transfer).
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-center">
                <span className="inline-flex items-center gap-1">
                  <ArrowDown className="size-3 text-bullish" />
                  Vào
                </span>
              </TableHead>
              <TableHead className="text-center">
                <span className="inline-flex items-center gap-1">
                  <ArrowUp className="size-3 text-bearish" />
                  Ra
                </span>
              </TableHead>
              <TableHead className="text-center">Xu hướng</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.slice(0, 20).map((h) => {
              const bal =
                h.balance !== null ? formatUnits(h.balance, h.decimals) : "—";
              const verdict =
                h.incoming.count > h.outgoing.count * 2
                  ? { text: "Gom", className: "bg-bullish/10 text-bullish" }
                  : h.outgoing.count > h.incoming.count * 2
                    ? { text: "Xả", className: "bg-bearish/10 text-bearish" }
                    : { text: "Luân chuyển", className: "bg-muted text-foreground" };
              return (
                <TableRow key={h.contract}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="font-mono text-sm font-medium">
                        {h.symbol ?? "?"}
                      </div>
                      {h.name && h.name !== h.symbol ? (
                        <div className="text-xs text-muted-foreground">
                          {h.name}
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="num tabular-nums text-right text-sm">
                    {bal}
                  </TableCell>
                  <TableCell className="num text-center text-sm tabular-nums">
                    {h.incoming.count}
                  </TableCell>
                  <TableCell className="num text-center text-sm tabular-nums">
                    {h.outgoing.count}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={cn("border-transparent", verdict.className)}
                    >
                      {verdict.text}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium">Gom</span> = inbound nhiều hơn outbound
          ≥ 2x ·{" "}
          <span className="font-medium">Xả</span> = outbound nhiều hơn ≥ 2x.
          Số liệu tính trong cửa sổ 50 transfer gần đây nhất, không phải toàn lịch sử.
        </p>
      </CardContent>
    </Card>
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
