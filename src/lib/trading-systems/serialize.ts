import type {
  SerializedTradingSystem,
  SerializedTradingSystemItem,
} from "./types";

type TradingSystemItemRow = {
  id: string;
  label: string;
  required: boolean;
  order: number;
};

type TradingSystemRow = {
  id: string;
  name: string;
  notes: string | null;
  isDefault: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
  items: TradingSystemItemRow[];
};

export function serializeTradingSystemItem(
  i: TradingSystemItemRow,
): SerializedTradingSystemItem {
  return {
    id: i.id,
    label: i.label,
    required: i.required,
    order: i.order,
  };
}

export function serializeTradingSystem(
  s: TradingSystemRow,
): SerializedTradingSystem {
  return {
    id: s.id,
    name: s.name,
    notes: s.notes,
    isDefault: s.isDefault,
    archived: s.archived,
    items: s.items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(serializeTradingSystemItem),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * The starter template seeded for new users. 5 universal pre-trade checks.
 */
export const DEFAULT_SYSTEM_TEMPLATE = {
  name: "Hệ thống mẫu",
  notes: "Checklist tối thiểu — sửa lại theo phong cách giao dịch của bạn.",
  items: [
    { label: "Setup theo trend chính (D1 / W1)", required: false },
    { label: "Entry tại vùng support/resistance hợp lý", required: false },
    { label: "RR tối thiểu 1:2", required: true },
    { label: "Không có tin tức lớn trong 30 phút tới", required: false },
    { label: "Đã đặt sẵn Stop loss và Take profit", required: true },
  ],
} as const;
