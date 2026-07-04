import { PageHeader } from "@/components/page-header";
import { InsightsClient } from "./insights-client";

export default function InsightsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Phân tích AI"
        description="AI chấm điểm xác suất tăng giá ngắn hạn (3–7 ngày) cho coin bạn chọn. Pick từ Top Trend (kỹ thuật đa khung) hoặc thêm tay — phân tích tự động chạy khi thêm."
      />
      <InsightsClient />
    </div>
  );
}
