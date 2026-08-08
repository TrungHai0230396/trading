import {
  LayoutDashboard,
  Calculator,
  BookOpenText,
  BookMarked,
  Radar,
  Settings,
  MessageSquarePlus,
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
        description:
          "Quét đồng thuận đa timeframe + watchlist Telegram + phân tích sâu từng coin",
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
      {
        label: "Hướng dẫn sử dụng",
        href: "/huong-dan",
        icon: BookMarked,
        description: "Cách dùng từng phần của app",
      },
      {
        label: "Liên hệ & Góp ý",
        href: "/feedback",
        icon: MessageSquarePlus,
        description: "Báo lỗi, đề xuất tính năng",
      },
    ],
  },
];
