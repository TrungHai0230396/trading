import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Calculator } from "lucide-react";

export default function CalculatorPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Position Size Calculator"
        description="Risk-based lot sizing for forex & crypto. Pip value & quote conversion via live rates."
      />
      <EmptyState
        icon={Calculator}
        title="Coming in Phase 2"
        description="The calculator UI lands in the next phase. It will support multiple risk models, account currencies, and live pip-value conversion."
      />
    </div>
  );
}
