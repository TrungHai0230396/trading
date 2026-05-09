import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { auth } from "@/lib/auth";
import { getOnchainReport } from "@/lib/onchain/service";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

import { ReportDisplay, type OnchainReportLike } from "../../_components/report-display";

export default async function OnchainReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    notFound();
  }

  const { id } = await params;
  const report = await getOnchainReport({ userId: session.user.id, id });
  if (!report) notFound();

  // Serialize Date → string-friendly object for the client component.
  const view: OnchainReportLike = {
    id: report.id,
    chain: report.chain,
    targetType: report.targetType,
    target: report.target,
    summary: report.summary,
    riskLevel: report.riskLevel,
    insights: report.insights,
    rawData: report.rawData,
    aiModel: report.aiModel,
    createdAt: report.createdAt.toISOString(),
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Chi tiết báo cáo"
        description="Báo cáo on-chain do Gemini tổng hợp từ dữ liệu explorer."
        actions={
          <Button variant="outline" size="sm" render={<Link href="/onchain" />}>
            <ChevronLeft className="size-4" />
            Quay lại
          </Button>
        }
      />
      <ReportDisplay report={view} />
    </div>
  );
}
