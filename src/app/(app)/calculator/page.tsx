import { PageHeader } from "@/components/page-header";
import { CalculatorClient } from "./calculator-client";

export default function CalculatorPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Position Size Calculator"
        description="Risk-based lot sizing for forex & crypto. Live prices via Twelve Data (FX) and Binance (crypto)."
      />
      <CalculatorClient />
    </div>
  );
}
