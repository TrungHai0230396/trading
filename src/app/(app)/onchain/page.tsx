import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Boxes } from "lucide-react";

export default function OnchainPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="On-chain Analysis"
        description="Paste a wallet, token or tx — fetch on-chain data (ETH/BSC) and let Gemini draft a risk/flow report."
      />
      <EmptyState
        icon={Boxes}
        title="Coming in Phase 6"
        description="Etherscan/BscScan + DefiLlama integrations and the AI report pipeline will live here."
      />
    </div>
  );
}
