import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  HeartPulse,
  Scale,
  ShieldOff,
  Tags,
  Target,
} from "lucide-react";

import { auth } from "@/lib/auth";
import {
  getAttributionStats,
  MIN_SAMPLE,
  type AttributionStats,
  type GroupBreakdown,
  type GroupStat,
} from "@/lib/journal/attribution-stats";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Below this many closed trades the whole report is noise, not insight. */
const NOISE_FLOOR = 10;

type Money = (n: number) => string;

function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(0)}%`;
}

export default async function JournalReviewPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const s = await getAttributionStats(userId);

  const fmt = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Signed for P/L, unsigned for a risk figure (a risk of "+50" reads wrong).
  const money: Money = (n) => `${n > 0 ? "+" : ""}${fmt.format(n)} ${s.currency}`;
  const amount: Money = (n) => `${fmt.format(n)} ${s.currency}`;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Điều gì đang lấy tiền của bạn"
        description="Tag, cảm xúc, sai lầm và kỷ luật — đọc lại từ chính những gì bạn đã ghi. Tất cả tính trên lệnh đã đóng. Đây là mô tả dữ liệu của bạn, không phải khuyến nghị."
        actions={
          <Button variant="outline" render={<Link href="/journal" />}>
            <ArrowLeft className="size-4" />
            Về Nhật ký
          </Button>
        }
      />

      {s.closedTrades === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Chưa có lệnh nào đã đóng. Đóng lệnh và nhập P/L, cảm xúc, sai lầm ở
            form Nhật ký để xem báo cáo tại đây.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Tổng {s.totalTrades} lệnh, {s.closedTrades} đã đóng.
          </p>

          {s.closedTrades < NOISE_FLOOR ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
              <AlertTriangle className="mt-px size-4 shrink-0" />
              <p>
                Mới {s.closedTrades} lệnh đã đóng — các con số dưới đây là nhiễu
                thống kê, chưa đủ để kết luận điều gì. Cần vài chục lệnh thì các
                cắt lớp này mới có nghĩa.
              </p>
            </div>
          ) : null}

          <GroupCard
            icon={<Tags className="size-4 text-primary" />}
            title="Theo tag"
            description="Mỗi lệnh có thể mang nhiều tag, nên tổng số lệnh ở cột dưới lớn hơn số lệnh đã đóng."
            data={s.byTag}
            headLabel="Tag"
            missingLabel="lệnh đã đóng không gắn tag nào"
            emptyText="Chưa lệnh đã đóng nào được gắn tag."
            closedTrades={s.closedTrades}
            money={money}
          />

          <GroupCard
            icon={<HeartPulse className="size-4 text-primary" />}
            title="Theo cảm xúc"
            description="Nhóm theo đúng chữ bạn gõ (không phân biệt hoa thường). Gõ thống nhất thì nhóm mới gọn."
            data={s.byEmotion}
            headLabel="Cảm xúc"
            missingLabel="lệnh đã đóng không ghi cảm xúc"
            emptyText="Chưa lệnh đã đóng nào ghi cảm xúc."
            closedTrades={s.closedTrades}
            money={money}
          />

          <GroupCard
            icon={<AlertTriangle className="size-4 text-primary" />}
            title="Theo sai lầm"
            description="Xếp theo tốn tiền nhất trước. Nhóm theo đúng chữ bạn gõ — hai câu khác nhau là hai nhóm khác nhau."
            data={s.byMistake}
            headLabel="Sai lầm đã ghi"
            missingLabel="lệnh đã đóng không ghi sai lầm"
            emptyText="Chưa lệnh đã đóng nào ghi sai lầm."
            closedTrades={s.closedTrades}
            money={money}
            wrapLabel
          />

          <StopCard s={s} money={money} />
          <ExitCard s={s} money={money} />
          <RiskDriftCard s={s} amount={amount} />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared table
// ──────────────────────────────────────────────────────────────────────

function StatRow({
  r,
  money,
  wrapLabel,
}: {
  r: GroupStat;
  money: Money;
  wrapLabel?: boolean;
}) {
  const pnlTone =
    r.withPnl === 0 ? null : r.totalPnl > 0 ? "up" : r.totalPnl < 0 ? "down" : null;

  return (
    <TableRow>
      <TableCell
        className={cn("font-medium", wrapLabel && "max-w-xs whitespace-normal")}
      >
        <span className={cn("align-middle", wrapLabel && "line-clamp-2")}>
          {r.label}
        </span>
        {r.trades > 0 && r.trades < MIN_SAMPLE ? (
          <Badge
            variant="outline"
            className="ml-2 align-middle text-[10px] font-normal"
          >
            mẫu nhỏ
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="num text-right">{r.trades}</TableCell>
      <TableCell className="num text-right">
        {r.winRate === null ? (
          "—"
        ) : (
          <>
            {pct(r.winRate)}
            <span className="ml-1 text-[10px] text-muted-foreground">
              {r.wins}/{r.withPnl}
            </span>
          </>
        )}
      </TableCell>
      <TableCell className="num text-right">
        {r.avgR === null ? (
          "—"
        ) : (
          <>
            <span
              className={cn(
                r.avgR > 0 && "text-bullish",
                r.avgR < 0 && "text-bearish",
              )}
            >
              {r.avgR >= 0 ? "+" : ""}
              {r.avgR.toFixed(2)}R
            </span>
            <span className="ml-1 text-[10px] text-muted-foreground">
              {r.withR}/{r.trades}
            </span>
          </>
        )}
      </TableCell>
      <TableCell className="num text-right">
        {/* P/L is user-entered: a bucket where nobody typed a figure shows "—",
            never a 0 that would read as break-even. */}
        {r.withPnl === 0 ? (
          "—"
        ) : (
          <>
            <span
              className={cn(
                pnlTone === "up" && "text-bullish",
                pnlTone === "down" && "text-bearish",
              )}
            >
              {money(r.totalPnl)}
            </span>
            {r.withPnl < r.trades ? (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {r.withPnl}/{r.trades}
              </span>
            ) : null}
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatTable({
  rows,
  headLabel,
  money,
  wrapLabel,
}: {
  rows: GroupStat[];
  headLabel: string;
  money: Money;
  wrapLabel?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{headLabel}</TableHead>
          <TableHead className="text-right">Lệnh</TableHead>
          <TableHead className="text-right">Tỷ lệ thắng</TableHead>
          <TableHead className="text-right">R trung bình</TableHead>
          <TableHead className="text-right">Tổng P/L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <StatRow key={r.label} r={r} money={money} wrapLabel={wrapLabel} />
        ))}
      </TableBody>
    </Table>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
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
      {hint ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Blocks
// ──────────────────────────────────────────────────────────────────────

function GroupCard({
  icon,
  title,
  description,
  data,
  headLabel,
  missingLabel,
  emptyText,
  closedTrades,
  money,
  wrapLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  data: GroupBreakdown;
  headLabel: string;
  missingLabel: string;
  emptyText: string;
  closedTrades: number;
  money: Money;
  wrapLabel?: boolean;
}) {
  const covered = closedTrades - data.missing;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          <>
            <Note>
              Tính trên {covered}/{closedTrades} lệnh đã đóng.
            </Note>
            <StatTable
              rows={data.rows}
              headLabel={headLabel}
              money={money}
              wrapLabel={wrapLabel}
            />
            {data.missing > 0 ? (
              <Note>
                {data.missing} {missingLabel}.
              </Note>
            ) : null}
            {data.hidden > 0 ? (
              <Note>Còn {data.hidden} nhóm nữa không hiển thị.</Note>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StopCard({ s, money }: { s: AttributionStats; money: Money }) {
  const { withStop, withoutStop } = s.stopDiscipline;
  const noStopRate =
    s.closedTrades > 0 ? withoutStop.trades / s.closedTrades : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldOff className="size-4 text-primary" />
          Lệnh không ghi stop loss
        </CardTitle>
        <CardDescription>
          {withoutStop.trades}/{s.closedTrades} lệnh đã đóng không có giá SL
          trong nhật ký ({pct(noStopRate)}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {withoutStop.trades === 0 ? (
          <p className="text-xs text-muted-foreground">
            Mọi lệnh đã đóng đều có ghi SL.
          </p>
        ) : withStop.trades === 0 ? (
          <p className="text-xs text-muted-foreground">
            Chưa lệnh đã đóng nào ghi SL, nên không có nhóm nào để so.
          </p>
        ) : (
          <StatTable
            rows={[withoutStop, withStop]}
            headLabel="Nhóm"
            money={money}
          />
        )}
        <Note>
          Đây là chuyện bạn có lưu giá SL vào nhật ký hay không — không phải bằng
          chứng lệnh có stop thật trên sàn.
        </Note>
      </CardContent>
    </Card>
  );
}

function ExitCard({ s, money }: { s: AttributionStats; money: Money }) {
  const e = s.exitClassification;
  const manualRate = e.classified > 0 ? e.manual.trades / e.classified : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="size-4 text-primary" />
          Lệnh đóng ở đâu so với SL/TP
        </CardTitle>
        <CardDescription>
          {e.classified === 0
            ? "Chưa lệnh đã đóng nào có đủ giá thoát kèm SL hoặc TP để phân loại."
            : `${pct(manualRate)} lệnh bạn đóng tay, giá chưa chạm SL hay TP.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {e.classified === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nhập giá thoát và SL/TP khi đóng lệnh để dùng mục này.
          </p>
        ) : (
          <>
            <Note>
              Tính trên {e.classified}/{s.closedTrades} lệnh đã đóng có giá thoát
              và ít nhất một mức SL hoặc TP
              {e.unclassified > 0
                ? ` — ${e.unclassified} lệnh còn lại thiếu dữ liệu để phân loại`
                : ""}
              .
              {e.classified < MIN_SAMPLE ? " Mẫu còn quá nhỏ." : ""}
            </Note>
            <StatTable
              rows={[e.manual, e.hitSl, e.hitTp]}
              headLabel="Kiểu thoát"
              money={money}
            />
          </>
        )}
        <Note>
          SL/TP dùng ở đây là giá trị ĐANG lưu trong lệnh. Nếu bạn dời stop hay
          chốt lời sau khi vào lệnh, bảng này không thấy được.
        </Note>
        <Note>
          App không lưu lịch sử giá, nên chỉ nói được lệnh đóng ở đâu so với
          SL/TP — không nói được sau đó giá đi tiếp thế nào.
        </Note>
      </CardContent>
    </Card>
  );
}

function RiskDriftCard({
  s,
  amount,
}: {
  s: AttributionStats;
  amount: Money;
}) {
  const d = s.riskDrift;
  const drift =
    d.driftRatio === null
      ? null
      : `${d.driftRatio > 0 ? "tăng" : d.driftRatio < 0 ? "giảm" : "không đổi"} ${Math.abs(
          d.driftRatio * 100,
        ).toFixed(0)}%`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="size-4 text-primary" />
          Risk sau thắng và sau thua
        </CardTitle>
        <CardDescription>
          Số tiền rủi ro của lệnh kế tiếp, xếp theo kết quả của lệnh đã đóng ngay
          trước nó.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {d.pairs === 0 ? (
          <p className="text-xs text-muted-foreground">
            Chưa có cặp lệnh liên tiếp nào đủ dữ liệu — cần lệnh sau có ghi số
            tiền rủi ro và lệnh trước có P/L.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Metric
                label="Risk TB sau một lệnh THẮNG"
                value={d.afterWin ? amount(d.afterWin.avgRisk) : "—"}
                hint={d.afterWin ? `${d.afterWin.count} lệnh` : undefined}
              />
              <Metric
                label="Risk TB sau một lệnh THUA"
                value={d.afterLoss ? amount(d.afterLoss.avgRisk) : "—"}
                hint={d.afterLoss ? `${d.afterLoss.count} lệnh` : undefined}
              />
            </div>
            {drift !== null ? (
              <p className="text-xs">
                Sau một lệnh thua, risk lệnh kế tiếp {drift} so với sau một lệnh
                thắng.
              </p>
            ) : null}
            <Note>
              Tính trên {d.pairs}/{s.closedTrades} cặp lệnh liên tiếp có đủ dữ
              liệu.
              {d.pairs < MIN_SAMPLE ? " Mẫu còn quá nhỏ." : ""}
            </Note>
          </>
        )}
        <Note>
          Lệnh không ghi số tiền rủi ro (nhập tay hoặc nhập từ MT lưu 0) bị bỏ
          qua. Lệnh trước hoà vốn cũng bỏ qua vì không phân loại được thắng/thua.
        </Note>
      </CardContent>
    </Card>
  );
}
