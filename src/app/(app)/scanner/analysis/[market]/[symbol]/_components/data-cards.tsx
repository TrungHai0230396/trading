/**
 * Server component that awaits the analysis snapshot once and renders
 * the non-AI cards: hero, trade plan, technical signals, volume,
 * support/resistance, related news. Sticky action bar at bottom is
 * client-side (see action-bar.tsx).
 */

import Link from "next/link";
import { Newspaper, TrendingUp, TrendingDown, Activity, BarChart3, Layers, Crosshair, AlertTriangle, History, User } from "lucide-react";

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

/**
 * Top block: hero (decision) + the user's own context + the trade plan.
 * The AI card renders BETWEEN the two blocks at page level — it explains
 * the plan, so it belongs next to it, not below the evidence tables.
 */
export async function DataCardsTop({ args }: { args: Args }) {
  const snap = await getCachedAnalysisSnapshot(...args);
  return (
    <>
      <HeroCard snap={snap} />
      <UserContextStrip snap={snap} />
      <TradePlanCard snap={snap} />
    </>
  );
}

/** Evidence block: per-TF signals, volume/structure, related news. */
export async function DataCardsEvidence({ args }: { args: Args }) {
  const snap = await getCachedAnalysisSnapshot(...args);
  return (
    <>
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
                Đồng thuận đa khung
              </span>
              {/* Honest framing: the "score" is a binary per-TF count
                  (only 0/25/50/75/100 exist for 4 TFs) — "4/4 khung" says
                  what it IS instead of dressing it up as a calibrated
                  0-100 measurement. */}
              <span className="num text-xl font-semibold tabular-nums">
                {bullBearCount(snap)}
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

        {snap.signalAge || snap.setupHistory ? (
          <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            {snap.signalAge ? (
              <p className="flex items-start gap-1.5">
                <History className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  Tín hiệu 4h giữ phía này{" "}
                  <span className="num font-medium">
                    {snap.signalAge.exhausted ? "≥" : ""}
                    {fmtBarsAge(snap.signalAge.bars)}
                  </span>{" "}
                  · giá đã chạy{" "}
                  <span
                    className={cn(
                      "num font-medium",
                      snap.signalAge.priceChangePct > 0
                        ? "text-bullish"
                        : snap.signalAge.priceChangePct < 0
                          ? "text-bearish"
                          : "",
                    )}
                  >
                    {snap.signalAge.priceChangePct >= 0 ? "+" : ""}
                    {snap.signalAge.priceChangePct}%
                  </span>{" "}
                  từ khi flip
                </span>
              </p>
            ) : null}
            {snap.setupHistory && snap.setupHistory.occurrences > 0 ? (
              <p className="flex items-start gap-1.5">
                <BarChart3 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  Tín hiệu 4h như vầy:{" "}
                  <span className="num font-medium">
                    {snap.setupHistory.occurrences} lần/
                    {snap.setupHistory.lookbackDays} ngày
                  </span>{" "}
                  · chạm TP1 trước SL{" "}
                  <span className="num font-medium">
                    {snap.setupHistory.tp1First}/
                    {snap.setupHistory.tp1First + snap.setupHistory.slFirst}
                  </span>
                  {snap.setupHistory.medianReturn7dPct !== null ? (
                    <>
                      {" "}
                      · TB{" "}
                      <span
                        className={cn(
                          "num font-medium",
                          snap.setupHistory.medianReturn7dPct > 0
                            ? "text-bullish"
                            : "text-bearish",
                        )}
                      >
                        {snap.setupHistory.medianReturn7dPct >= 0 ? "+" : ""}
                        {snap.setupHistory.medianReturn7dPct}%
                      </span>{" "}
                      sau 7 ngày
                    </>
                  ) : null}
                  <span className="text-muted-foreground">
                    {" "}
                    (replay theo đúng luật SL/TP của kế hoạch — quá khứ không
                    đảm bảo tương lai)
                  </span>
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        <Separator />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className={cn("flex items-center gap-2", verdictColor)}>
            <Icon className="size-5" />
            <span className="text-lg font-semibold">
              {verdictLabel(snap.recommendation.verdict)}
            </span>
            <ConfidenceChip confidence={snap.recommendation.confidence} />
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

function bullBearCount(snap: SnapshotShape): string {
  const total = snap.perTF.length;
  const bull = snap.perTF.filter((t) => t.signal === "BULLISH").length;
  const bear = snap.perTF.filter((t) => t.signal === "BEARISH").length;
  if (bull >= bear) return `${bull}/${total} khung BULL`;
  return `${bear}/${total} khung BEAR`;
}

function fmtBarsAge(bars: number): string {
  const hours = bars * 4;
  if (hours < 48) return `${hours} giờ`;
  return `${Math.round(hours / 24)} ngày`;
}

function ConfidenceChip({
  confidence,
}: {
  confidence: "low" | "medium" | "high";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        confidence === "high" && "bg-bullish/10 text-bullish",
        confidence === "medium" && "bg-warning/10 text-warning",
        confidence === "low" && "bg-muted text-muted-foreground",
      )}
    >
      {confidenceLabel(confidence)}
    </span>
  );
}

// ── "Bối cảnh của bạn" — journal + watchlist relationship ────────────

function UserContextStrip({ snap }: { snap: SnapshotShape }) {
  const ctx = snap.userContext;
  const hasAnything =
    ctx.openTrades.length > 0 || ctx.closedCount > 0 || ctx.inWatchlist;
  if (!hasAnything) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-medium">
        <User className="size-3.5 text-muted-foreground" />
        Bối cảnh của bạn
      </span>
      {ctx.openTrades.length > 0 ? (
        <span className="font-medium text-warning">
          ⚠ Đang mở {ctx.openTrades.length} lệnh {snap.base} (
          {ctx.openTrades.map((t) => t.direction).join(", ")}) — vào thêm là
          tăng gấp exposure
        </span>
      ) : null}
      {ctx.closedCount > 0 ? (
        <span className="text-muted-foreground">
          Đã đóng {ctx.closedCount} lệnh {snap.base}
          {ctx.totalR !== null ? (
            <>
              {" "}
              · tổng{" "}
              <span
                className={cn(
                  "num font-medium",
                  ctx.totalR > 0 ? "text-bullish" : ctx.totalR < 0 ? "text-bearish" : "",
                )}
              >
                {ctx.totalR > 0 ? "+" : ""}
                {ctx.totalR}R
              </span>
            </>
          ) : null}
          {" · "}
          <Link
            href={`/journal?symbol=${encodeURIComponent(snap.symbol)}`}
            className="underline hover:text-foreground"
          >
            xem lại
          </Link>
        </span>
      ) : null}
      {ctx.inWatchlist ? (
        <span className="text-muted-foreground">
          🔔 Đang theo dõi — có alert Telegram khi đạt/gãy đồng thuận
        </span>
      ) : null}
    </div>
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
              {" · "}
              <span title="Entry lấy theo giá thị trường tại thời điểm quét — mở lại trang để cập nhật">
                giá lúc quét {fmtClock(snap.generatedAt)}
              </span>
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
        {/* One grid, not two 3-tile rows — on mobile (2 cols) two rows
            wrapped as 2+1 / 2+1 with awkward orphans. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Đòn bẩy yêu cầu"
            value={`${plan.leverageRequired}×`}
            sub="isolated"
          />
          <StatTile
            label="Margin đề xuất"
            value={`${fmtUsd(plan.margin)} USDT`}
            sub={`Risk ${fmtUsd(plan.riskAmount)} USDT`}
          />
          <StatTile
            label="Khối lượng"
            value={`${fmtUnits(plan.units)} ${snap.base}`}
            sub={`Notional ${fmtUsd(plan.notional)} USDT`}
          />
          <StatTile
            label="Giá thanh lý"
            value={
              plan.liquidationPrice === null
                ? "—"
                : fmtPrice(plan.liquidationPrice)
            }
            sub={
              plan.liquidationPrice === null
                ? "1× isolated — gần như không thể thanh lý"
                : "ước tính, gồm ký quỹ duy trì ~0.5%"
            }
          />
          <StatTile
            label="Phí round-trip"
            value={`${plan.expectedFees} USDT`}
            sub={`${plan.feesPctOfR.toFixed(0)}% của R`}
          />
          <StatTile
            label={
              snap.balanceSource === "real" ? "Số dư Futures thực" : "Số dư giả định"
            }
            value={`${fmtUsd(snap.accountBalance)} USDT`}
            sub={
              snap.balanceSource === "real"
                ? `từ sàn đã kết nối · Risk ${(snap.riskPercent * 100).toFixed(1)}%`
                : `chưa kết nối sàn · Risk ${(snap.riskPercent * 100).toFixed(1)}%`
            }
          />
        </div>
        {plan.headroomR !== null && plan.firstBarrier !== null ? (
          <p className="text-xs text-muted-foreground">
            {plan.direction === "LONG" ? "Kháng cự" : "Hỗ trợ"} đầu tiên{" "}
            <span className="num font-medium text-foreground">
              {fmtPrice(plan.firstBarrier)}
            </span>{" "}
            = <span className="num font-medium text-foreground">+{plan.headroomR}R</span>
            {plan.headroomR >= 2
              ? " — TP2 (2R) nằm an toàn trước cản"
              : " — cản nằm trước TP2, cân nhắc chốt sớm"}
          </p>
        ) : null}
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
    // A whole empty card was dead weight pushing the action bar below the
    // fold — one muted footnote carries the same information.
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Newspaper className="size-3.5" />
        Chưa có tin tức gắn thẻ {snap.base}.
      </p>
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

/** USDT amounts — grouped, 2dp. */
function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Position size — grouped, precision scaled to magnitude (3381.867794
 *  was false precision overflowing its tile). Full precision still goes
 *  to planToText + deep-links, which use the raw plan values. */
function fmtUnits(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const dp = n >= 100 ? 1 : n >= 1 ? 3 : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

function fmtClock(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime())
    ? "—"
    : t.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
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
