import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { JournalClient } from "./journal-client";

export default function JournalPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Nhật ký giao dịch"
        description="Ghi lệnh, đính kèm setup, gắn tag, theo dõi P/L và R-multiple."
        actions={
          <>
            <Button variant="outline" render={<Link href="/journal/import" />}>
              <Download className="size-4" />
              Nhập từ MT4/MT5
            </Button>
            <Button render={<Link href="/journal/new" />}>
              <Plus className="size-4" />
              Lệnh mới
            </Button>
          </>
        }
      />
      <JournalClient />
    </div>
  );
}
