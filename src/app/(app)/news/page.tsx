import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Newspaper } from "lucide-react";

export default function NewsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Tin tức & AI"
        description="Tin tức crypto/macro tổng hợp, kèm tóm tắt + sentiment + impact do Gemini phân tích."
      />
      <EmptyState
        icon={Newspaper}
        title="Đang phát triển"
        description="Sẽ tích hợp CryptoPanic feed và pipeline tóm tắt bằng Gemini."
      />
    </div>
  );
}
