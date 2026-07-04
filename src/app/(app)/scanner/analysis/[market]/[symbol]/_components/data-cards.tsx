/**
 * Server component that awaits the analysis snapshot once and renders
 * the non-AI cards: hero, trade plan, technical signals, volume,
 * support/resistance, related news. Sticky action bar at bottom is
 * client-side (see action-bar.tsx).
 */

import Link from "next/link";
import { Newspaper, TrendingUp, TrendingDown, Activity, BarChart3, Layers, Crosshair, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getCachedAnalysisSnapshot } from "@/lib/analysis/snapshot";
import {
  verdictLabel,
  confidenceLabel,
} from "@/lib/analysis/recommendation";

type Args = readonly [
  string,
  "CRYPTO" | "FOREX",
  string,
  number | undefined,
  number | undefined,
];

export async function DataCards({ args }: { args: Args }) {
  const snap = await getCachedAnalysisSnapshot(...args);

  // NOTE: ActionBar is rendered SEPARATELY at page level after the AI
  // narrative, not here — otherwise it ends up sandwiched between the
  // news card and the AI card, far from the page bottom.
  return (
    <>
      <HeroCard snap={snap} />
      <TradePlanCard snap={snap} />
      <div className="grid gap-4 md:grid-cols-2">
        <TechnicalCard snap={snap} />
        <SecondaryCard snap={snap} />
      </div>
      <NewsCard snap={snap} />
    </>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────

function HeroCard({ snap }: { snap: SnapshotShape }) {
  const verdictColor =
    snap.recommendation.verdict === "ENTER_LONG"
      ? "text-bullish"
      : snap.recommendation.verdict === "ENTER_SHORT"
        ? "text-bearish"
        : "text-warning";

  const Icon =
    snap.recommendation.verdict === "ENTER_LONG"
      ? TrendingUp
      : snap.recommendation.verdict === "ENTER_SHORT"
        ? TrendingDown
        : Activity;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-mono text-lg">{snap.symbol}</CardTitle>
            <CardDescription>
              Đa khung 1h · 4h · 1d · 1w · ATR({snap.atrTimeframe})
            </CardDescription>
          </div>
          <Badge variant="outline" className="uppercase">
            {snap.market}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Giá hiện tại</div>
            <div className="num text-3xl font-semibold tabular-nums">
              {fmtPrice(snap.price.last)}
            </div>
            <div className="mt-1 flex gap-3 text-xs">
              {snap.price.change24hPct !== null ? (
                <span className={pctClass(snap.price.change24hPct)}>
                  {fmtPct(snap.price.change24hPct)} 24h
                </span>
              ) : null}
              {snap.price.high24h !== null && snap.price.low24h !== null ? (
                <span className="text-muted-foreground">
                  H/L: {fmtPrice(snap.price.high24h)} / {fmtPrice(snap.price.low24h)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">
                Điểm đồng thuận
              </span>
              <span className="num text-xl font-semibold tabular-nums">
                {snap.consensus.score.toFixed(0)}/100
              </span>
            </div>
            <ScoreBar value={snap.consensus.score} />
            <div className="flex flex-wrap gap-1.5">
              {snap.perTF.map((tf) => (
                <SignalChip key={tf.timeframe} tf={tf.timeframe} signal={tf.signal} />
              ))}
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className={cn("flex items-center gap-2", verdictColor)}>
            <Icon className="size-5" />
            <span className="text-lg font-semibold">
              {verdictLabel(snap.recommendation.verdict)}
            </span>
            <span className="text-xs text-muted-foreground">
              ({confidenceLabel(snap.recommendation.confidence)})
            </span>
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground sm:text-right">
            {snap.recommendation.reasons.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 75 ? "bg-bullish" : pct <= 25 ? "bg-bearish" : "bg-warning";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full transition-all", color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SignalChip({
  tf,
  signal,
}: {
  tf: string;
  signal: "BULLISH" | "BEARISH" | "NEUTRAL";
}) {
  const className =
    signal === "BULLISH"
      ? "bg-bullish/15 text-bullish border-bullish/30"
      : signal === "BEARISH"
        ? "bg-bearish/15 text-bearish border-bearish/30"
        : "bg-muted text-muted-foreground border-border";
  const arrow = signal === "BULLISH" ? "↑" : signal === "BEARISH" ? "↓" : "·";
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", className)}>
      {tf} {arrow}
    </Badge>
  );
}

// ── Trade Plan ───────────────────────────────────────────────────────

function TradePlanCard({ snap }: { snap: SnapshotShape }) {
  const plan = snap.tradePlan;
  if (!plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Crosshair className="size-4 text-primary" />
            Kế hoạch giao dịch
          </CardTitle>
          <CardDescription>
            Tín hiệu chưa rõ — đợi đồng thuận mạnh hơn hoặc pullback về vùng
            ổn định trước khi mở lệnh.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isLong = plan.direction === "LONG";
  const dirColor = isLong ? "text-bullish" : "text-bearish";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Crosshair className="size-4 text-primary" />
              Kế hoạch giao dịch
            </CardTitle>
            <CardDescription>
              <span className={cn("font-semibold", dirColor)}>{plan.direction}</span>
              {" · "}
              ATR({snap.atrTimeframe}) {plan.atrMultiple.toFixed(2)}×
              {" · "}
              SL {plan.slPct.toFixed(2)}%
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Entry" value={fmtPrice(plan.entryPrice)} />
          <StatTile
            label="Stop Loss"
            value={fmtPrice(plan.slPrice)}
            sub={`-${plan.slPct.toFixed(2)}%`}
            color="text-bearish"
          />
          <StatTile
            label="TP1 (1R)"
            value={fmtPrice(plan.tp1Price)}
            sub="RR 1:1"
            color="text-bullish"
          />
          <StatTile
            label="TP2 (2R)"
            value={fmtPrice(plan.tp2Price)}
            sub="RR 1:2"
            color="text-bullish"
          />
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Đòn bẩy yêu cầu"
            value={`${plan.leverageRequired}×`}
            sub="isolated"
          />
          <StatTile
            label="Margin đề xuất"
            value={`${plan.margin} USDT`}
            sub={`Risk ${plan.riskAmount}`}
          />
          <StatTile
            label="Khối lượng"
            value={`${plan.units} ${snap.base}`}
            sub={`Notional ${plan.notional} USDT`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Giá thanh lý"
            value={fmtPrice(plan.liquidationPrice)}
            sub="approx (no fees)"
          />
          <StatTile
            label="Phí round-trip"
            value={`${plan.expectedFees} USDT`}
            sub={`${plan.feesPctOfR.toFixed(0)}% của R`}
          />
          <StatTile
            label="Số dư giả định"
            value={`${snap.accountBalance} USDT`}
            sub={`Risk ${(snap.riskPercent * 100).toFixed(1)}%`}
          />
        </div>
        {plan.warnings.length > 0 ? (
          <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
            {plan.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-md border bg-card/40 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("num text-base font-semibold tabular-nums", color)}>
        {value}
      </div>
      {sub ? (
        <div className="text-[10px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

// ── Technical card (per-TF table) ────────────────────────────────────

function TechnicalCard({ snap }: { snap: SnapshotShape }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-primary" />
          Tín hiệu kỹ thuật
        </CardTitle>
        <CardDescription>
          EMA(9) vs WMA(45) trên RSI(14) cho từng khung.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1.5 text-left font-medium">TF</th>
              <th className="py-1.5 text-right font-medium">RSI</th>
              <th className="py-1.5 text-right font-medium">EMA(RSI)</th>
              <th className="py-1.5 text-right font-medium">WMA(RSI)</th>
              <th className="py-1.5 text-right font-medium">Tín hiệu</th>
            </tr>
          </thead>
          <tbody>
            {snap.perTF.map((tf) => {
              const strat = tf.perStrategy.find(
                (p) => p.strategy === "ema-wma-on-rsi",
              );
              const ind = strat?.indicators ?? {};
              return (
                <tr key={tf.timeframe} className="border-b last:border-0">
                  <td className="py-1.5 font-mono text-sm">{tf.timeframe}</td>
                  <td className="num py-1.5 text-right text-xs tabular-nums">
                    {fmtNum(ind.rsi)}
                  </td>
                  <td className="num py-1.5 text-right text-xs tabular-nums">
                    {fmtNum(ind.emaOnRsi)}
                  </td>
                  <td className="num py-1.5 text-right text-xs tabular-nums">
                    {fmtNum(ind.wmaOnRsi)}
                  </td>
                  <td className="py-1.5 text-right">
                    <SignalPill signal={tf.signal} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-muted-foreground">
          BULL khi EMA(RSI) &gt; WMA(RSI). RSI &gt; 70 = quá mua, &lt; 30 = quá bán.
        </p>
      </CardContent>
    </Card>
  );
}

function SignalPill({
  signal,
}: {
  signal: "BULLISH" | "BEARISH" | "NEUTRAL";
}) {
  const className =
    signal === "BULLISH"
      ? "bg-bullish/15 text-bullish"
      : signal === "BEARISH"
        ? "bg-bearish/15 text-bearish"
        : "bg-muted text-muted-foreground";
  const label =
    signal === "BULLISH" ? "BULL" : signal === "BEARISH" ? "BEAR" : "—";
  return (
    <Badge className={cn("font-mono text-[10px]", className)} variant="outline">
      {label}
    </Badge>
  );
}

// ── Secondary card: volume + S/R ─────────────────────────────────────

function SecondaryCard({ snap }: { snap: SnapshotShape }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-primary" />
          Khối lượng & cấu trúc
        </CardTitle>
        <CardDescription>
          Volume vs TB 20 ngày · kháng cự / hỗ trợ gần nhất.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {snap.volume ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Volume 24h</span>
              <span className="num text-sm font-medium tabular-nums">
                {fmtMillions(snap.volume.last24h)} USDT
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">
                TB 20 ngày (1d)
              </span>
              <span className="num text-sm tabular-nums">
                {fmtMillions(snap.volume.avg20d)} USDT
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Tỉ lệ</span>
              <span
                className={cn(
                  "num text-sm font-semibold tabular-nums",
                  snap.volume.classification === "high" && "text-bullish",
                  snap.volume.classification === "low" && "text-warning",
                )}
              >
                {snap.volume.ratio.toFixed(2)}× ({classLabel(snap.volume.classification)})
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Khối lượng không khả dụng cho thị trường này.
          </p>
        )}

        <Separator />

        <div className="space-y-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">
              Kháng cự gần nhất
            </div>
            {snap.nearestResistance.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {snap.nearestResistance.map((r, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="border-bearish/30 bg-bearish/5 font-mono text-[11px]"
                  >
                    {fmtPrice(r.price)}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Không có swing high rõ ràng phía trên.
              </p>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">
              Hỗ trợ gần nhất
            </div>
            {snap.nearestSupport.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {snap.nearestSupport.map((r, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="border-bullish/30 bg-bullish/5 font-mono text-[11px]"
                  >
                    {fmtPrice(r.price)}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Không có swing low rõ ràng phía dưới.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function classLabel(c: "high" | "low" | "normal"): string {
  if (c === "high") return "Khối lượng cao";
  if (c === "low") return "Khối lượng yếu";
  return "Khối lượng bình thường";
}

// ── News ─────────────────────────────────────────────────────────────

function NewsCard({ snap }: { snap: SnapshotShape }) {
  if (snap.news.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Newspaper className="size-4 text-primary" />
            Tin tức liên quan
          </CardTitle>
          <CardDescription>
            Chưa có tin tức gắn thẻ {snap.base}. Chạy tổng hợp tin ở trang Tin
            tức để cải thiện ngữ cảnh.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Newspaper className="size-4 text-primary" />
          Tin tức liên quan ({snap.news.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {snap.news.map((n) => (
            <li key={n.id} className="flex items-start gap-2">
              <SentimentDot sentiment={n.sentiment} />
              <div className="flex-1">
                <Link
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm hover:underline"
                >
                  {n.title}
                </Link>
                <div className="text-[11px] text-muted-foreground">
                  {n.source} · {formatTimeAgo(n.publishedAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SentimentDot({ sentiment }: { sentiment: string | null }) {
  const s = (sentiment ?? "").toLowerCase();
  const color =
    s.startsWith("bull") || s === "positive"
      ? "bg-bullish"
      : s.startsWith("bear") || s === "negative"
        ? "bg-bearish"
        : "bg-muted-foreground/50";
  return <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", color)} />;
}

// ── helpers ──────────────────────────────────────────────────────────

type SnapshotShape = Awaited<ReturnType<typeof getCachedAnalysisSnapshot>>;

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

function fmtNum(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function pctClass(n: number): string {
  if (n > 0) return "text-bullish";
  if (n < 0) return "text-bearish";
  return "text-muted-foreground";
}

function fmtMillions(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(0);
}

function formatTimeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
