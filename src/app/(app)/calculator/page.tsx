import { PageHeader } from "@/components/page-header";
import { CalculatorClient } from "./calculator-client";

export default function CalculatorPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Tính khối lượng lệnh"
        description="Tính lot theo số tiền risk cho forex & crypto. Giá realtime qua Twelve Data (FX) và Binance (crypto)."
      />
      <CalculatorClient />
    </div>
  );
}
