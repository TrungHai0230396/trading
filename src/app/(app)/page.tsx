import Link from "next/link";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DashboardClient } from "./dashboard-client";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Tổng quan"
        description="Tài sản, hiệu suất và tín hiệu — tự làm mới mỗi 60 giây."
        actions={
          <Button
            size="sm"
            className="self-start"
            render={<Link href="/journal/new" />}
          >
            <Plus className="size-4" />
            Lệnh mới
          </Button>
        }
      />
      <DashboardClient />
    </div>
  );
}
