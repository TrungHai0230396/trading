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
        description="Chấm điểm đồng thuận RSI/EMA-WMA và EMA20/EMA50 trên các khung 1h, 4h, 1d. Điểm 0 = bearish toàn phần, 100 = bullish toàn phần."
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
