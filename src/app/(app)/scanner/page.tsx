import Link from "next/link";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ScannerClient } from "./scanner-client";

export default function ScannerPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Quét đa khung thời gian"
        description="Chấm điểm mức đồng thuận của tín hiệu EMA/WMA trên RSI, qua các khung thời gian bạn chọn. 0 = mọi khung bearish, 100 = mọi khung bullish. Đây là công cụ quan sát, không phải khuyến nghị mua bán."
        actions={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/scanner/runs" />}
          >
            <History className="mr-1 size-4" />
            Lịch sử quét
          </Button>
        }
      />
      <ScannerClient />
    </div>
  );
}
