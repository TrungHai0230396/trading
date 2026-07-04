/**
 * Trading system = pre-trade checklist.
 *
 * Each system has a name, optional notes, and an ordered list of items.
 * Items can be marked `required` — the trade form warns (but doesn't block)
 * when a required item is left unchecked.
 */
import { z } from "zod";

export const tradingSystemItemSchema = z.object({
  /** Existing item id when updating; omitted for new items. */
  id: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(255),
  required: z.boolean().default(false),
});
export type TradingSystemItemInput = z.infer<typeof tradingSystemItemSchema>;

const optionalNotes = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const tradingSystemUpsertSchema = z.object({
  name: z.string().trim().min(1).max(80),
  notes: optionalNotes,
  isDefault: z.boolean().default(false),
  // Order is implied by array position.
  items: z.array(tradingSystemItemSchema).max(50).default([]),
});
export type TradingSystemUpsertInput = z.infer<typeof tradingSystemUpsertSchema>;

export const tradingSystemPatchSchema = tradingSystemUpsertSchema.partial();
export type TradingSystemPatchInput = z.infer<typeof tradingSystemPatchSchema>;

/**
 * Snapshot of a checklist captured at trade creation. Stored on
 * `TradeJournal.systemChecks` (JSON column).
 */
export const systemCheckSnapshotSchema = z.object({
  label: z.string().trim().min(1).max(255),
  required: z.boolean(),
  checked: z.boolean(),
});
export type SystemCheckSnapshot = z.infer<typeof systemCheckSnapshotSchema>;

export const systemChecksArraySchema = z.array(systemCheckSnapshotSchema).max(50);
