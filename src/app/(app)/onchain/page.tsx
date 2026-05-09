import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Boxes } from "lucide-react";

export default function OnchainPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Phân tích On-chain"
        description="Dán địa chỉ ví/token/tx — lấy dữ liệu on-chain (ETH/BSC) và để Gemini viết báo cáo dòng tiền/risk."
      />
      <EmptyState
        icon={Boxes}
        title="Đang phát triển"
        description="Sẽ tích hợp Etherscan/BscScan + DefiLlama và pipeline AI tạo báo cáo."
      />
    </div>
  );
}
