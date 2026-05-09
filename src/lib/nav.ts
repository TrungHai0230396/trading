import {
  LayoutDashboard,
  Calculator,
  BookOpenText,
  Radar,
  Newspaper,
  Boxes,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  description?: string;
};

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Cockpit",
    items: [
      {
        label: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
        description: "Overview & today's activity",
      },
      {
        label: "Position Size",
        href: "/calculator",
        icon: Calculator,
        description: "Risk-based lot sizing",
      },
      {
        label: "Journal",
        href: "/journal",
        icon: BookOpenText,
        description: "Trade log + stats",
      },
    ],
  },
  {
    label: "Analysis",
    items: [
      {
        label: "Multi-TF Scanner",
        href: "/scanner",
        icon: Radar,
        description: "RSI/MACD across timeframes",
      },
      {
        label: "News & AI",
        href: "/news",
        icon: Newspaper,
        description: "Aggregated + AI-summarized",
      },
      {
        label: "On-chain",
        href: "/onchain",
        icon: Boxes,
        description: "Wallet/token AI analysis",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
      },
    ],
  },
];
