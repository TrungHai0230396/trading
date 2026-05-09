import { PageHeader } from "@/components/page-header";
import { InsightsClient } from "./insights-client";

export default function InsightsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Phân tích top 10"
        description="AI chấm điểm xác suất tăng giá ngắn hạn (3–7 ngày) cho top 10 Forex / Crypto. Dữ liệu: giá hiện tại + biến động + tin tức gần đây của bạn."
      />
      <InsightsClient />
    </div>
  );
}
