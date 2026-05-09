import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { BookOpenText } from "lucide-react";

export default function JournalPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Trading Journal"
        description="Log trades, attach screenshots, tag setups & emotions, review R-multiples."
      />
      <EmptyState
        icon={BookOpenText}
        title="Coming in Phase 3"
        description="Journal CRUD, filters, stats and screenshot uploads will be implemented next."
      />
    </div>
  );
}
