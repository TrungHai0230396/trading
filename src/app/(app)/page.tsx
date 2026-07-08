import { PageHeader } from "@/components/page-header";
import { DashboardClient } from "./dashboard-client";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Tổng quan"
        description="Số liệu trực tiếp từ nhật ký, Bitget và lần quét gần nhất — tự làm mới mỗi 60 giây."
      />
      <DashboardClient />
    </div>
  );
}
