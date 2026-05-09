"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, Sparkles } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

import { ReportDisplay, type OnchainReportLike } from "./_components/report-display";
import { RiskBadge } from "./_components/risk-badge";

type Chain = "ETH" | "BSC";
type TargetType = "WALLET" | "TOKEN" | "TRANSACTION";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TXHASH_RE = /^0x[a-fA-F0-9]{64}$/;

const TARGET_TABS: { value: TargetType; label: string; placeholder: string }[] = [
  {
    value: "WALLET",
    label: "Ví",
    placeholder: "0x… (40 hex)",
  },
  {
    value: "TOKEN",
    label: "Token",
    placeholder: "0x… (40 hex)",
  },
  {
    value: "TRANSACTION",
    label: "Giao dịch",
    placeholder: "0x… (64 hex)",
  },
];

function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function isValidTarget(targetType: TargetType, value: string): boolean {
  const t = value.trim();
  return targetType === "TRANSACTION" ? TXHASH_RE.test(t) : ADDRESS_RE.test(t);
}

type ListResponse = {
  items: OnchainReportLike[];
  nextCursor: string | null;
};

export function OnchainClient() {
  const qc = useQueryClient();

  const [chain, setChain] = React.useState<Chain>("ETH");
  const [targetType, setTargetType] = React.useState<TargetType>("WALLET");
  const [target, setTarget] = React.useState("");
  const [report, setReport] = React.useState<OnchainReportLike | null>(null);

  const reports = useQuery<ListResponse>({
    queryKey: ["onchain-reports"],
    queryFn: async () => {
      const res = await fetch("/api/onchain/reports", { cache: "no-store" });
      if (!res.ok) throw new Error("Không tải được lịch sử báo cáo");
      return (await res.json()) as ListResponse;
    },
  });

  const analyze = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onchain/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain, targetType, target: target.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Phân tích thất bại");
      return data as OnchainReportLike;
    },
    onSuccess: (r) => {
      setReport(r);
      toast.success("Đã có báo cáo on-chain");
      qc.invalidateQueries({ queryKey: ["onchain-reports"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Lỗi"),
  });

  const valid = isValidTarget(targetType, target);
  const submit = () => {
    if (!valid || analyze.isPending) return;
    analyze.mutate();
  };

  const onTargetTypeChange = (v: string | null) => {
    if (!v) return;
    setTargetType(v as TargetType);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              Phân tích mới
            </CardTitle>
            <CardDescription>
              Chọn chain + loại target, dán địa chỉ hoặc tx hash. Gemini sẽ đọc
              dữ liệu thô từ explorer và viết báo cáo tiếng Việt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Chain</Label>
              <Select
                value={chain}
                onValueChange={(v) => v && setChain(v as Chain)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ETH">Ethereum (ETH)</SelectItem>
                  <SelectItem value="BSC">BNB Smart Chain (BSC)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Loại target</Label>
              <Tabs
                value={targetType}
                onValueChange={onTargetTypeChange}
              >
                <TabsList className="grid w-full grid-cols-3">
                  {TARGET_TABS.map((t) => (
                    <TabsTrigger key={t.value} value={t.value}>
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="space-y-1.5">
              <Label>
                {targetType === "TRANSACTION" ? "Tx hash" : "Address"}
              </Label>
              <Input
                className="num"
                placeholder={
                  TARGET_TABS.find((t) => t.value === targetType)?.placeholder
                }
                value={target}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              {target && !valid ? (
                <p className="text-xs text-bearish">
                  {targetType === "TRANSACTION"
                    ? "Tx hash phải có dạng 0x + 64 ký tự hex."
                    : "Address phải có dạng 0x + 40 ký tự hex."}
                </p>
              ) : null}
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={!valid || analyze.isPending}
              onClick={submit}
            >
              {analyze.isPending ? "Đang phân tích…" : "Phân tích"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Lịch sử gần đây</CardTitle>
            <CardDescription>
              Các báo cáo bạn đã tạo. Click để xem lại.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reports.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : reports.data && reports.data.items.length > 0 ? (
              <ul className="space-y-2">
                {reports.data.items.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setReport(r)}
                      className={cn(
                        "w-full rounded-md border bg-card/40 p-3 text-left transition hover:border-primary/40 hover:bg-card",
                        report?.id === r.id && "border-primary/60 bg-card",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono uppercase">
                            {r.chain}
                          </span>
                          <span>
                            {r.targetType === "WALLET"
                              ? "Wallet"
                              : r.targetType === "TOKEN"
                                ? "Token"
                                : "Tx"}
                          </span>
                        </div>
                        <RiskBadge level={r.riskLevel} />
                      </div>
                      <p
                        className="num mt-1 truncate text-xs"
                        title={r.target}
                      >
                        {shortAddress(r.target)}
                      </p>
                      {r.summary ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {r.summary}
                        </p>
                      ) : null}
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <time>
                          {new Date(r.createdAt).toLocaleString("vi-VN")}
                        </time>
                        <Link
                          href={`/onchain/reports/${r.id}`}
                          className="underline-offset-2 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Mở trang
                        </Link>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Chưa có báo cáo nào.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        {report ? (
          <ReportDisplay report={report} />
        ) : (
          <EmptyState
            icon={Boxes}
            title="Chưa có báo cáo"
            description="Dán address ví, token contract hoặc tx hash, bấm Phân tích — Gemini sẽ trả về tóm tắt + risk level + insight chi tiết."
          />
        )}
      </div>
    </div>
  );
}
