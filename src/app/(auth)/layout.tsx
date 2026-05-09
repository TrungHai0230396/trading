import { LineChart } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <LineChart className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Tranding</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Trading Cockpit
              </div>
            </div>
          </div>
          {children}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary/15 via-background to-background lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(0.78_0.17_159/0.12),transparent_60%)]" />
        <div className="relative flex h-full flex-col items-center justify-center gap-4 px-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Trade with intent.
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Position sizing, journal, multi-timeframe scanning, AI-assisted news
            and on-chain insight — in one place.
          </p>
        </div>
      </div>
    </div>
  );
}
