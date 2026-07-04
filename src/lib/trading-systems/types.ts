import type { SystemCheckSnapshot } from "./schema";

export type SerializedTradingSystemItem = {
  id: string;
  label: string;
  required: boolean;
  order: number;
};

export type SerializedTradingSystem = {
  id: string;
  name: string;
  notes: string | null;
  isDefault: boolean;
  archived: boolean;
  items: SerializedTradingSystemItem[];
  createdAt: string;
  updatedAt: string;
};

export type TradingSystemListResponse = {
  items: SerializedTradingSystem[];
};

export type TradingSystemDetailResponse = SerializedTradingSystem;

/** Re-export so client code only needs one import path. */
export type { SystemCheckSnapshot };
