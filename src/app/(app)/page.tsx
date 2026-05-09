import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Activity, BookOpenText, Calculator, Newspaper, Radar, TrendingUp } from "lucide-react";

const stats = [
  { label: "P/L hôm nay", value: "—", hint: "Chưa có nhật ký" },
  { label: "Lệnh đang mở", value: "0", hint: "Không có lệnh mở" },
  { label: "Win rate (30 ngày)", value: "—", hint: "Cần lịch sử giao dịch" },
  { label: "R-multiple TB", value: "—", hint: "Cần lệnh đã đóng" },
];

const quickLinks = [
  { href: "/calculator", icon: Calculator, label: "Tính khối lượng", desc: "Tính lot theo risk" },
  { href: "/journal", icon: BookOpenText, label: "Nhật ký", desc: "Ghi lệnh mới" },
  { href: "/scanner", icon: Radar, label: "Quét đa khung", desc: "Tín hiệu đa TF" },
  { href: "/news", icon: Newspaper, label: "Tin tức & AI", desc: "Tin nóng hôm nay" },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Tổng quan"
        description="Cái nhìn toàn cảnh về phiên giao dịch của bạn. Số liệu sẽ cập nhật khi bạn ghi nhật ký và chạy quét."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="border-border/60">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-medium uppercase tracking-wider">
                {s.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="num text-2xl font-semibold">{s.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              Đường equity
            </CardTitle>
            <CardDescription>
              P/L tích lũy của các lệnh đã đóng. Sẽ hiển thị sau khi bạn ghi
              nhật ký.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={TrendingUp}
              title="Chưa có lịch sử giao dịch"
              description="Ghi lệnh đầu tiên ở Nhật ký để bắt đầu theo dõi hiệu suất."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Truy cập nhanh</CardTitle>
            <CardDescription>Mở nhanh các tác vụ thường dùng.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {quickLinks.map(({ href, icon: Icon, label, desc }) => (
              <a
                key={href}
                href={href}
                className="group flex items-center gap-3 rounded-md border border-transparent px-3 py-2 transition hover:border-border hover:bg-accent/40"
              >
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              </a>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
