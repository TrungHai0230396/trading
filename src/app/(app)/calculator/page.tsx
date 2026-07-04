import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { CalculatorClient } from "./calculator-client";

export default function CalculatorPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Tính khối lượng lệnh"
        description="Tính lot theo số tiền risk cho forex & crypto. Giá realtime qua Twelve Data (FX) và Binance (crypto)."
      />
      {/* `useSearchParams` inside CalculatorClient requires this Suspense
          boundary at the Server-Component layer in Next 16. */}
      <Suspense fallback={null}>
        <CalculatorClient />
      </Suspense>
    </div>
  );
}
