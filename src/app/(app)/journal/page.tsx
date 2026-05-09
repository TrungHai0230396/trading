import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { BookOpenText } from "lucide-react";

export default function JournalPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Nhật ký giao dịch"
        description="Ghi lệnh, đính kèm screenshot, gắn tag setup & cảm xúc, theo dõi R-multiple."
      />
      <EmptyState
        icon={BookOpenText}
        title="Đang phát triển"
        description="CRUD nhật ký, lọc, thống kê và upload screenshot sẽ có ở giai đoạn tiếp theo."
      />
    </div>
  );
}
