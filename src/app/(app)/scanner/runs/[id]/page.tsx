import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { SignalPill, ScoreBar, type SignalLike } from "../../signal-pill";
import {
  STRATEGY_LABELS,
  type StrategyId,
} from "@/lib/scanner/strategies";

type StrategyRow = {
  strategy: StrategyId;
  signal: SignalLike;
  indicators: Record<string, number>;
};

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(d);
}

function isStrategyRow(x: unknown): x is StrategyRow {
  return (
    typeof x === "object" &&
    x !== null &&
    "strategy" in x &&
    "signal" in x &&
    "indicators" in x
  );
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const run = await db.analysisRun.findFirst({
    where: { id, userId: session.user.id },
    include: {
      results: { orderBy: [{ symbol: "asc" }, { timeframe: "asc" }] },
    },
  });
  if (!run) notFound();

  const symbols = (run.symbols as unknown as string[]) ?? [];
  const timeframes = (run.timeframes as unknown as string[]) ?? [];
  const indicators = (run.indicators as unknown as StrategyId[]) ?? [];

  // Aggregate per symbol → score & alignment.
  type Row = {
    symbol: string;
    score: number;
    alignment: SignalLike;
    perTF: Map<string, { signal: SignalLike; strategies: StrategyRow[]; error?: string }>;
  };
  const rowsBySymbol = new Map<string, Row>();
  for (const sym of symbols) {
    rowsBySymbol.set(sym, {
      symbol: sym,
      score: 50,
      alignment: "MIXED",
      perTF: new Map(),
    });
  }

  for (const r of run.results) {
    let row = rowsBySymbol.get(r.symbol);
    if (!row) {
      row = { symbol: r.symbol, score: 50, alignment: "MIXED", perTF: new Map() };
      rowsBySymbol.set(r.symbol, row);
    }
    const indicatorsField = r.indicators as unknown;
    let strategies: StrategyRow[] = [];
    let error: string | undefined;
    if (Array.isArray(indicatorsField)) {
      strategies = indicatorsField.filter(isStrategyRow) as StrategyRow[];
    } else if (
      typeof indicatorsField === "object" &&
      indicatorsField !== null &&
      "error" in indicatorsField
    ) {
      const e = (indicatorsField as { error?: unknown }).error;
      error = typeof e === "string" ? e : undefined;
    }
    row.perTF.set(r.timeframe, {
      signal: r.signal as SignalLike,
      strategies,
      error,
    });
  }

  // compute score per symbol from TF signals (matching runner)
  const summary = [...rowsBySymbol.values()].map((row) => {
    let bull = 0;
    let bear = 0;
    let total = 0;
    for (const tf of timeframes) {
      const cell = row.perTF.get(tf);
      if (!cell) continue;
      total++;
      if (cell.signal === "BULLISH") bull++;
      else if (cell.signal === "BEARISH") bear++;
    }
    let score = 50;
    if (total > 0) {
      if (bull === total) score = 100;
      else if (bear === total) score = 0;
      else score = 50 + ((bull - bear) / total) * 50;
    }
    const alignment: SignalLike =
      bull > 0 && bear === 0
        ? "BULLISH"
        : bear > 0 && bull === 0
          ? "BEARISH"
          : "MIXED";
    return { ...row, score: Math.round(score * 10) / 10, alignment };
  });
  summary.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`Phiên quét #${run.id.slice(0, 8)}`}
        description={`${fmtDate(run.createdAt)} · ${symbols.length} symbol · TF: ${timeframes.join(", ")}`}
        actions={
          <Button variant="outline" render={<Link href="/scanner/runs" />}>
            <ChevronLeft className="mr-1 size-4" />
            Quay lại lịch sử
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {run.market}
        </Badge>
        {indicators.map((id) => (
          <Badge key={id} variant="secondary" className="text-[11px]">
            {STRATEGY_LABELS[id] ?? id}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tổng hợp</CardTitle>
            <CardDescription>
              Mỗi dòng là một symbol. Cột TF hiển thị tín hiệu tổng hợp của các
              chỉ báo cho khung đó.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Điểm</TableHead>
                  <TableHead>Đồng thuận</TableHead>
                  {timeframes.map((tf) => (
                    <TableHead key={tf} className="text-center font-mono">
                      {tf}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((row) => (
                  <TableRow key={row.symbol}>
                    <TableCell className="font-mono text-sm">
                      {row.symbol}
                    </TableCell>
                    <TableCell>
                      <ScoreBar value={row.score} />
                    </TableCell>
                    <TableCell>
                      <SignalPill signal={row.alignment} />
                    </TableCell>
                    {timeframes.map((tf) => {
                      const cell = row.perTF.get(tf);
                      if (!cell) {
                        return (
                          <TableCell
                            key={tf}
                            className="text-center text-muted-foreground"
                          >
                            –
                          </TableCell>
                        );
                      }
                      if (cell.error) {
                        return (
                          <TableCell key={tf} className="text-center">
                            <span
                              className="inline-flex h-5 items-center rounded-md bg-destructive/10 px-1.5 text-[11px] text-destructive"
                              title={cell.error}
                            >
                              lỗi
                            </span>
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={tf} className="text-center">
                          <SignalPill signal={cell.signal} compact />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chi tiết chỉ báo</CardTitle>
            <CardDescription>
              Giá trị thô của từng chỉ báo trên từng symbol × TF.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>TF</TableHead>
                  <TableHead>Chỉ báo</TableHead>
                  <TableHead>Tín hiệu</TableHead>
                  <TableHead>Giá trị</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.flatMap((row) =>
                  timeframes.flatMap((tf) => {
                    const cell = row.perTF.get(tf);
                    if (!cell) return [];
                    if (cell.error) {
                      return [
                        <TableRow key={`${row.symbol}-${tf}-err`}>
                          <TableCell className="font-mono text-sm">
                            {row.symbol}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {tf}
                          </TableCell>
                          <TableCell colSpan={3} className="text-destructive">
                            {cell.error}
                          </TableCell>
                        </TableRow>,
                      ];
                    }
                    return cell.strategies.map((s) => (
                      <TableRow key={`${row.symbol}-${tf}-${s.strategy}`}>
                        <TableCell className="font-mono text-sm">
                          {row.symbol}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {tf}
                        </TableCell>
                        <TableCell>
                          {STRATEGY_LABELS[s.strategy] ?? s.strategy}
                        </TableCell>
                        <TableCell>
                          <SignalPill signal={s.signal} compact />
                        </TableCell>
                        <TableCell className="num text-xs tabular-nums text-muted-foreground">
                          {Object.entries(s.indicators)
                            .map(
                              ([k, v]) =>
                                `${k}=${Number.isFinite(v) ? v : "–"}`,
                            )
                            .join(" · ")}
                        </TableCell>
                      </TableRow>
                    ));
                  }),
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
