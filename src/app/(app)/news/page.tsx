import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Newspaper } from "lucide-react";

export default function NewsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="News & AI"
        description="Aggregated crypto / macro news with Gemini-powered summary, sentiment & impact tagging."
      />
      <EmptyState
        icon={Newspaper}
        title="Coming in Phase 5"
        description="CryptoPanic feed + Gemini summarization pipeline will be wired up here."
      />
    </div>
  );
}
