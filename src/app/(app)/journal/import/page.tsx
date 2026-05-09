import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { MtImportClient } from "./mt-import-client";

export default async function JournalImportPage() {
  const session = await auth();
  const accounts = session?.user
    ? await db.tradingAccount.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, currency: true },
      })
    : [];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Nhập từ MT4 / MT5"
        description="Tải lên báo cáo HTML từ MetaTrader để tự động tạo nhật ký lệnh."
        actions={
          <Button variant="outline" render={<Link href="/journal" />}>
            <ArrowLeft className="size-4" />
            Quay lại
          </Button>
        }
      />
      <MtImportClient
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
        }))}
      />
    </div>
  );
}
