"use client";

import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { ExternalLink, Newspaper, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────
// Types — mirror /api/news/list response
// ──────────────────────────────────────────────────────────────────────

type Sentiment = "bullish" | "bearish" | "neutral";
type Impact = "high" | "medium" | "low";

type NewsItem = {
  id: string;
  externalId: string | null;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  summary: string | null;
  sentiment: Sentiment | string | null;
  impact: Impact | string | null;
  tags: string[];
  aiModel: string | null;
  createdAt: string;
};

type ListResponse = {
  items: NewsItem[];
  nextCursor: string | null;
  sources: string[];
};

type RefreshResponse = {
  inserted: number;
  skipped: number;
  fetched: number;
  errors: Array<{ externalId: string; title: string; message: string }>;
};

type Filters = {
  sentiment: string; // "all" | Sentiment
  impact: string; // "all" | Impact
  source: string; // "all" | string
  q: string;
};

const INITIAL_FILTERS: Filters = {
  sentiment: "all",
  impact: "all",
  source: "all",
  q: "",
};

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export function NewsClient() {
  const qc = useQueryClient();
  const [filters, setFilters] = React.useState<Filters>(INITIAL_FILTERS);
  const [debouncedQ, setDebouncedQ] = React.useState("");

  // Debounce free-text search to avoid hammering the API on every keystroke.
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(filters.q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [filters.q]);

  const queryKey = React.useMemo(
    () => [
      "news",
      "list",
      {
        sentiment: filters.sentiment,
        impact: filters.impact,
        source: filters.source,
        q: debouncedQ,
      },
    ],
    [filters.sentiment, filters.impact, filters.source, debouncedQ],
  );

  const list = useQuery<ListResponse>({
    queryKey,
    queryFn: async () => {
      const url = new URL("/api/news/list", window.location.origin);
      if (filters.sentiment !== "all")
        url.searchParams.set("sentiment", filters.sentiment);
      if (filters.impact !== "all")
        url.searchParams.set("impact", filters.impact);
      if (filters.source !== "all")
        url.searchParams.set("source", filters.source);
      if (debouncedQ) url.searchParams.set("q", debouncedQ);
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Không tải được danh sách tin");
      }
      return data as ListResponse;
    },
    staleTime: 30_000,
  });

  const refresh = useMutation<RefreshResponse>({
    mutationFn: async () => {
      const res = await fetch("/api/news/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Làm mới thất bại");
      return data as RefreshResponse;
    },
    onSuccess: (data) => {
      const total = data.inserted + data.skipped;
      const detail = `${data.inserted} mới, ${data.skipped} bỏ qua`;
      if (data.errors.length > 0) {
        toast.warning(`Đã làm mới (${detail}). ${data.errors.length} lỗi tóm tắt.`);
      } else if (total === 0) {
        toast.info("Không có tin nào trả về.");
      } else {
        toast.success(`Đã làm mới — ${detail}.`);
      }
      qc.invalidateQueries({ queryKey: ["news", "list"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Làm mới thất bại"),
  });

  const sources = list.data?.sources ?? [];
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          <RefreshCw
            className={cn("mr-1.5", refresh.isPending && "animate-spin")}
          />
          {refresh.isPending ? "Đang làm mới…" : "Làm mới"}
        </Button>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        sources={sources}
      />

      {list.isLoading ? (
        <SkeletonList />
      ) : list.isError ? (
        <EmptyState
          icon={Newspaper}
          title="Không tải được tin"
          description={
            list.error instanceof Error ? list.error.message : "Có lỗi xảy ra."
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title="Chưa có tin nào — bấm Làm mới"
          description="Hệ thống sẽ kéo tin từ CryptoPanic và tóm tắt bằng Gemini."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ArticleCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Filter bar
// ──────────────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  sources,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  sources: string[];
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <Card size="sm">
      <CardContent className="grid gap-3 py-1 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Sentiment
          </span>
          <Select
            value={filters.sentiment}
            onValueChange={(v) => v && set("sentiment", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="bullish">Tích cực</SelectItem>
              <SelectItem value="bearish">Tiêu cực</SelectItem>
              <SelectItem value="neutral">Trung tính</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Impact
          </span>
          <Select
            value={filters.impact}
            onValueChange={(v) => v && set("impact", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="high">Cao</SelectItem>
              <SelectItem value="medium">Trung bình</SelectItem>
              <SelectItem value="low">Thấp</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Nguồn
          </span>
          <Select
            value={filters.source}
            onValueChange={(v) => v && set("source", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Tìm kiếm
          </span>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.q}
              onChange={(e) => set("q", e.target.value)}
              placeholder="Tìm theo tiêu đề / tóm tắt"
              className="pl-7"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Article card
// ──────────────────────────────────────────────────────────────────────

function ArticleCard({ item }: { item: NewsItem }) {
  const published = new Date(item.publishedAt);
  let relative = "";
  try {
    relative = formatDistanceToNow(published, {
      locale: vi,
      addSuffix: true,
    });
  } catch {
    relative = published.toLocaleString("vi-VN");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{item.source}</Badge>
          <span className="text-xs text-muted-foreground">{relative}</span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {item.impact ? <ImpactBadge impact={item.impact} /> : null}
            {item.sentiment ? (
              <SentimentBadge sentiment={item.sentiment} />
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group/title inline-flex items-start gap-1.5 text-base font-medium leading-snug hover:underline"
        >
          <span>{item.title}</span>
          <ExternalLink className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/title:text-foreground" />
        </a>

        {item.summary ? (
          <p className="text-sm text-muted-foreground">{item.summary}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            Chưa có tóm tắt.
          </p>
        )}

        {item.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {item.tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[0.7rem]">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Badges (semantic colors)
// ──────────────────────────────────────────────────────────────────────

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const s = sentiment.toLowerCase();
  if (s === "bullish") {
    return (
      <Badge className="bg-bullish/15 text-bullish hover:bg-bullish/20">
        Tích cực
      </Badge>
    );
  }
  if (s === "bearish") {
    return (
      <Badge className="bg-bearish/15 text-bearish hover:bg-bearish/20">
        Tiêu cực
      </Badge>
    );
  }
  return <Badge variant="secondary">Trung tính</Badge>;
}

function ImpactBadge({ impact }: { impact: string }) {
  const i = impact.toLowerCase();
  if (i === "high") {
    return (
      <Badge className="bg-warning/15 text-warning hover:bg-warning/20">
        Impact: Cao
      </Badge>
    );
  }
  if (i === "medium") {
    return (
      <Badge className="bg-info/15 text-info hover:bg-info/20">
        Impact: Trung bình
      </Badge>
    );
  }
  return <Badge variant="secondary">Impact: Thấp</Badge>;
}

// ──────────────────────────────────────────────────────────────────────
// Loading skeleton
// ──────────────────────────────────────────────────────────────────────

function SkeletonList() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-24" />
              <div className="ml-auto flex gap-1.5">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
