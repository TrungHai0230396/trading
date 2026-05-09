import { PageHeader } from "@/components/page-header";
import { OnchainClient } from "./onchain-client";

export default function OnchainPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Phân tích On-chain"
        description="Dán địa chỉ ví/token/tx — lấy dữ liệu on-chain (ETH/BSC) và để Gemini viết báo cáo dòng tiền/risk."
      />
      <OnchainClient />
    </div>
  );
}
