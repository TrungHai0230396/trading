import { PageHeader } from "@/components/page-header";
import { NewsClient } from "./news-client";

export default function NewsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Tin tức & AI"
        description="Tin tức crypto/macro tổng hợp từ CryptoPanic, kèm tóm tắt + sentiment + impact do Gemini phân tích."
      />
      <NewsClient />
    </div>
  );
}
