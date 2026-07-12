import { PageHeader } from "@/components/page-header";
import { auth } from "@/lib/auth";
import { FeedbackClient } from "./feedback-client";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const session = await auth();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Liên hệ & Góp ý"
        description="Báo lỗi, đề xuất tính năng, hay chỉ muốn nói chuyện — mình đọc hết."
      />
      <FeedbackClient email={session?.user?.email ?? null} />
    </div>
  );
}
