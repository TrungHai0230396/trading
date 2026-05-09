import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, History } from "lucide-react";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScoreBar } from "../signal-pill";

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

export default async function RunsListPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const runs = await db.analysisRun.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      results: { select: { symbol: true, score: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Lịch sử quét"
        description="Các phiên quét gần đây — bấm vào để xem chi tiết từng symbol và TF."
      />

      {runs.length === 0 ? (
        <EmptyState
          icon={History}
          title="Chưa có phiên quét nào"
          description="Vào trang Quét đa khung và chạy phiên đầu tiên."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Thị trường</TableHead>
                  <TableHead>Symbols</TableHead>
                  <TableHead>TF</TableHead>
                  <TableHead>Top symbol</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const symbols = (run.symbols as unknown as string[]) ?? [];
                  const tfs = (run.timeframes as unknown as string[]) ?? [];
                  const byScore = new Map<string, number>();
                  for (const r of run.results) {
                    if (r.score == null) continue;
                    const cur = byScore.get(r.symbol) ?? -Infinity;
                    if (r.score > cur) byScore.set(r.symbol, r.score);
                  }
                  const top = [...byScore.entries()].sort(
                    (a, b) => b[1] - a[1],
                  )[0];

                  return (
                    <TableRow key={run.id} className="cursor-pointer">
                      <TableCell className="text-sm text-muted-foreground">
                        <Link
                          href={`/scanner/runs/${run.id}`}
                          className="hover:underline"
                        >
                          {fmtDate(run.createdAt)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {run.market}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{symbols.length}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {tfs.join(" · ")}
                      </TableCell>
                      <TableCell>
                        {top ? (
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm">{top[0]}</span>
                            <ScoreBar value={top[1]} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/scanner/runs/${run.id}`}
                          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                        >
                          Chi tiết <ChevronRight className="size-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
