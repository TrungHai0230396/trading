"use client";

/**
 * Error boundary for the deep-analysis route. Without it, a Binance
 * hiccup or a well-formed-but-nonexistent symbol (FOOUSDT) rejected the
 * Suspense boundary and surfaced Next's raw error screen.
 */

import Link from "next/link";
import { AlertTriangle, ChevronLeft, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AnalysisError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <AlertTriangle className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Không lấy được dữ liệu</h2>
        <p className="text-sm text-muted-foreground">
          Symbol không tồn tại trên Binance, hoặc sàn đang chậm. Thử lại sau
          vài giây.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => reset()}>
          <RotateCcw className="size-4" />
          Thử lại
        </Button>
        <Button variant="outline" size="sm" render={<Link href="/scanner" />}>
          <ChevronLeft className="size-4" />
          Quay lại scanner
        </Button>
      </div>
    </div>
  );
}
