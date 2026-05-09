import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Radar } from "lucide-react";

export default function ScannerPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Multi-Timeframe Scanner"
        description="Scan top coins/forex with combined RSI/MACD/EMA across timeframes — only flagging assets where signals align."
      />
      <EmptyState
        icon={Radar}
        title="Coming in Phase 4"
        description="Port the triple-timeframe RSI alignment logic from the existing bots and add MACD/EMA modes."
      />
    </div>
  );
}
