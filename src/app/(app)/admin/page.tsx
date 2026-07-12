import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getAdminStats } from "@/lib/admin/stats";

// Always render fresh — this is a live monitoring view.
export const dynamic = "force-dynamic";

function fmtBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function ago(iso: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - iso) / 1000));
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground/70">{hint}</div>
      ) : null}
    </div>
  );
}

const CRON_LABELS: Record<string, string> = {
  "broker-sync": "Đồng bộ sàn (2 phút)",
  "consensus-scan": "Quét đồng thuận (15 phút)",
  "news-refresh": "Làm mới tin (1 giờ)",
};

const FEEDBACK_LABEL: Record<string, string> = {
  BUG: "🐞 Lỗi",
  FEATURE: "✨ Tính năng",
  OTHER: "💬 Góp ý",
};

export default async function AdminPage() {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

  const stats = await getAdminStats();
  const nowMs = Date.parse(stats.generatedAt);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Quản trị"
        description="Thống kê dữ liệu & sức khoẻ hệ thống. Chỉ chủ sở hữu xem được."
      />

      {/* ── Sức khoẻ hệ thống ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sức khoẻ hệ thống</CardTitle>
          <CardDescription>
            Số liệu cron tính kể từ lần khởi động gần nhất (uptime{" "}
            {fmtDuration(stats.health.uptimeSec)}).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Cơ sở dữ liệu:</span>
            {stats.health.dbOk ? (
              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                Đang chạy
              </Badge>
            ) : (
              <Badge variant="destructive">Mất kết nối</Badge>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Tác vụ nền</th>
                  <th className="pb-2 font-medium">Chạy gần nhất</th>
                  <th className="pb-2 font-medium">Trạng thái</th>
                  <th className="pb-2 font-medium">Thời lượng</th>
                  <th className="pb-2 font-medium">Lượt / Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {stats.health.crons.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-3 text-muted-foreground"
                    >
                      Chưa có tác vụ nào chạy kể từ khi khởi động.
                    </td>
                  </tr>
                ) : (
                  stats.health.crons.map((c) => (
                    <tr key={c.name} className="border-b last:border-0">
                      <td className="py-2">
                        {CRON_LABELS[c.name] ?? c.name}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {ago(c.lastRunAt, nowMs)}
                      </td>
                      <td className="py-2">
                        {c.ok ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            OK
                          </span>
                        ) : (
                          <span
                            className="text-destructive"
                            title={c.lastError}
                          >
                            Lỗi
                          </span>
                        )}
                      </td>
                      <td className="py-2 tabular-nums text-muted-foreground">
                        {(c.durationMs / 1000).toFixed(1)}s
                      </td>
                      <td className="py-2 tabular-nums text-muted-foreground">
                        {c.runs} / {c.errors}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Người dùng ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Người dùng</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Tổng người dùng" value={stats.users.total} />
            <Stat label="Mới 24 giờ" value={stats.users.new24h} />
            <Stat label="Mới 7 ngày" value={stats.users.new7d} />
            <Stat label="Mới 30 ngày" value={stats.users.new30d} />
            <Stat label="Đã kết nối sàn" value={stats.users.withBroker} />
            <Stat label="Đã kết nối Telegram" value={stats.users.withTelegram} />
            <Stat
              label="Được cấp auto-trade"
              value={stats.users.autotradeGranted}
              hint="qua AppSetting (chưa tính allowlist env)"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Hoạt động ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hoạt động</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Tổng lệnh nhật ký" value={stats.activity.tradesTotal} />
            <Stat label="Lệnh đang mở" value={stats.activity.tradesOpen} />
            <Stat
              label="Lệnh sàn (broker)"
              value={stats.activity.brokerOrdersTotal}
            />
            <Stat label="Symbol watchlist" value={stats.activity.watchlistSymbols} />
            <Stat label="Lượt quét đã lưu" value={stats.activity.analysisRuns} />
          </div>
          {stats.activity.brokerOrdersByStatus.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {stats.activity.brokerOrdersByStatus.map((s) => (
                <Badge key={s.status} variant="outline" className="font-mono text-[11px]">
                  {s.status}: {s.count}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Lưu trữ ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lưu trữ</CardTitle>
          <CardDescription>
            Ảnh screenshot lưu base64 thẳng trong MySQL nên chiếm phần lớn dung
            lượng DB — theo dõi ở đây để tránh đầy ổ đĩa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Số ảnh" value={stats.storage.screenshots} />
            <Stat
              label="Dung lượng ảnh"
              value={fmtBytes(stats.storage.screenshotBytes)}
            />
            <Stat
              label="Tổng dung lượng DB"
              value={fmtBytes(stats.storage.dbBytes)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Phản hồi người dùng ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Phản hồi
            {stats.feedback.newCount > 0 ? (
              <Badge className="bg-primary/15 text-primary">
                {stats.feedback.newCount} mới
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Báo lỗi & góp ý gửi từ trang Liên hệ (15 mục gần nhất).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats.feedback.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có phản hồi nào.</p>
          ) : (
            <ul className="space-y-2.5">
              {stats.feedback.recent.map((f) => (
                <li key={f.id} className="rounded-lg border bg-card/40 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {FEEDBACK_LABEL[f.type] ?? f.type}
                    </span>
                    <span>{new Date(f.createdAt).toLocaleString("vi-VN")}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{f.message}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    {f.email ? <span>{f.email}</span> : null}
                    {f.context ? <span>· {f.context}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Người dùng gần đây ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Đăng ký gần đây</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium">Tên</th>
                  <th className="pb-2 font-medium">Ngày tạo</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentUsers.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-3 text-muted-foreground">
                      Chưa có người dùng nào.
                    </td>
                  </tr>
                ) : (
                  stats.recentUsers.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-2">{u.email}</td>
                      <td className="py-2 text-muted-foreground">
                        {u.name ?? "—"}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {new Date(u.createdAt).toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
