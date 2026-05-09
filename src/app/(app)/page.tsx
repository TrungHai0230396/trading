import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Activity, BookOpenText, Calculator, Newspaper, Radar, TrendingUp } from "lucide-react";

const stats = [
  { label: "Today P/L", value: "—", hint: "Connect journal" },
  { label: "Open Trades", value: "0", hint: "No open positions" },
  { label: "Win Rate (30d)", value: "—", hint: "Need trade history" },
  { label: "Avg R-multiple", value: "—", hint: "Need closed trades" },
];

const quickLinks = [
  { href: "/calculator", icon: Calculator, label: "Position Size", desc: "Risk-based sizing" },
  { href: "/journal", icon: BookOpenText, label: "Journal", desc: "Log a trade" },
  { href: "/scanner", icon: Radar, label: "Scanner", desc: "Multi-TF signals" },
  { href: "/news", icon: Newspaper, label: "News & AI", desc: "Today's headlines" },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Dashboard"
        description="A bird's-eye view of your trading day. Stats populate as you log trades and run scans."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="border-border/60">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-medium uppercase tracking-wider">
                {s.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="num text-2xl font-semibold">{s.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              Equity curve
            </CardTitle>
            <CardDescription>
              Closed-trade P/L over time. Will render once you log trades.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={TrendingUp}
              title="No trade history yet"
              description="Log your first trade in the Journal to start tracking performance."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
            <CardDescription>Jump into common tasks.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {quickLinks.map(({ href, icon: Icon, label, desc }) => (
              <a
                key={href}
                href={href}
                className="group flex items-center gap-3 rounded-md border border-transparent px-3 py-2 transition hover:border-border hover:bg-accent/40"
              >
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              </a>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
