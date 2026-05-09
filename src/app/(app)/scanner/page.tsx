import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Radar } from "lucide-react";

export default function ScannerPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Quét đa khung thời gian"
        description="Quét top coin/forex bằng RSI/MACD/EMA kết hợp nhiều khung thời gian — chỉ báo tín hiệu khi các TF cùng đồng thuận."
      />
      <EmptyState
        icon={Radar}
        title="Đang phát triển"
        description="Tôi sẽ port logic 3-TF alignment từ bot RSI hiện tại và bổ sung MACD/EMA ở giai đoạn tiếp theo."
      />
    </div>
  );
}
