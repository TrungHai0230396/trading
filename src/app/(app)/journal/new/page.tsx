import { PageHeader } from "@/components/page-header";
import { TradeFormClient } from "../trade-form-client";

export default function NewTradePage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Lệnh mới"
        description="Ghi lại giao dịch: symbol, hướng, khối lượng, giá vào/ra và setup."
      />
      <TradeFormClient mode="new" />
    </div>
  );
}
