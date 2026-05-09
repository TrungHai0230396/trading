import {
  LayoutDashboard,
  Calculator,
  BookOpenText,
  Radar,
  Newspaper,
  Boxes,
  Settings,
  Sparkles,
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
    label: "Bảng điều khiển",
    items: [
      {
        label: "Tổng quan",
        href: "/",
        icon: LayoutDashboard,
        description: "Tổng hợp số liệu & hoạt động trong ngày",
      },
      {
        label: "Tính khối lượng",
        href: "/calculator",
        icon: Calculator,
        description: "Tính lot theo số tiền risk",
      },
      {
        label: "Nhật ký giao dịch",
        href: "/journal",
        icon: BookOpenText,
        description: "Ghi lệnh + thống kê",
      },
    ],
  },
  {
    label: "Phân tích",
    items: [
      {
        label: "Quét đa khung",
        href: "/scanner",
        icon: Radar,
        description: "RSI/MACD/EMA trên nhiều timeframe",
      },
      {
        label: "Phân tích top",
        href: "/insights",
        icon: Sparkles,
        description: "AI chấm điểm % tăng/giảm cho top 10",
      },
      {
        label: "Tin tức & AI",
        href: "/news",
        icon: Newspaper,
        description: "Tin tổng hợp + AI tóm tắt",
      },
      {
        label: "On-chain",
        href: "/onchain",
        icon: Boxes,
        description: "Phân tích ví/token bằng AI",
      },
    ],
  },
  {
    label: "Hệ thống",
    items: [
      {
        label: "Cài đặt",
        href: "/settings",
        icon: Settings,
      },
    ],
  },
];
