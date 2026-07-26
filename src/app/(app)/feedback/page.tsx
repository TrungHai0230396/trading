import { PageHeader } from "@/components/page-header";
import { FeedbackClient } from "./feedback-client";

export const dynamic = "force-dynamic";

export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Liên hệ & Góp ý"
        description="Báo lỗi, đề xuất tính năng, hay chỉ muốn nói chuyện — mình đọc hết."
      />
      <FeedbackClient />
    </div>
  );
}
