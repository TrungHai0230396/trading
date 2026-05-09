import { z } from "zod";

export const MARKETS = [
  "FOREX",
  "CRYPTO",
  "STOCK",
  "COMMODITY",
  "INDEX",
  "OTHER",
] as const;

export const DIRECTIONS = ["LONG", "SHORT"] as const;
export const STATUSES = ["OPEN", "CLOSED", "CANCELED"] as const;

const optionalString = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalShortString = z
  .string()
  .trim()
  .max(120)
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalNumber = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .transform((s) => s.replace(",", "."))
      .refine((s) => s === "" || !Number.isNaN(Number(s)), {
        message: "Giá trị không hợp lệ",
      })
      .transform((s) => (s === "" ? undefined : Number(s))),
  ])
  .optional();

const requiredNumber = z.union([
  z.number(),
  z
    .string()
    .trim()
    .transform((s) => s.replace(",", "."))
    .refine((s) => s !== "" && !Number.isNaN(Number(s)), {
      message: "Giá trị không hợp lệ",
    })
    .transform((s) => Number(s)),
]);

const optionalDate = z
  .union([z.string(), z.date()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  });

const requiredDate = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), {
    message: "Thời gian không hợp lệ",
  });

const optionalCuid = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .optional()
  .or(z.literal("").transform(() => undefined));

// Base shape without cross-field refinements so we can derive a partial schema
// for PATCH (Zod 4 disallows .partial() on schemas with refinements).
export const tradeUpsertBaseSchema = z.object({
  symbol: z.string().trim().min(1).max(40).transform((s) => s.toUpperCase()),
  market: z.enum(MARKETS),
  direction: z.enum(DIRECTIONS),
  status: z.enum(STATUSES).default("OPEN"),

  timeframe: optionalShortString,

  entryPrice: requiredNumber.refine((n) => n > 0, {
    message: "Giá vào lệnh phải > 0",
  }),
  exitPrice: optionalNumber.refine((n) => n === undefined || n > 0, {
    message: "Giá đóng lệnh phải > 0",
  }),
  stopLoss: optionalNumber.refine((n) => n === undefined || n > 0, {
    message: "Stop loss phải > 0",
  }),
  takeProfit: optionalNumber.refine((n) => n === undefined || n > 0, {
    message: "Take profit phải > 0",
  }),
  lotSize: requiredNumber.refine((n) => n > 0, {
    message: "Khối lượng phải > 0",
  }),
  riskAmount: requiredNumber.refine((n) => n >= 0, {
    message: "Số tiền risk không được âm",
  }),
  pnl: optionalNumber,
  feesAmount: optionalNumber,

  openedAt: requiredDate,
  closedAt: optionalDate,

  strategyId: optionalCuid,
  accountId: optionalCuid,

  setup: optionalString,
  notes: optionalString,
  mistakes: optionalString,
  emotion: optionalShortString,

  tagNames: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

function ensureClosedAfterOpened(
  data: { openedAt?: Date; closedAt?: Date | undefined },
  ctx: z.RefinementCtx,
) {
  if (data.closedAt && data.openedAt && data.closedAt < data.openedAt) {
    ctx.addIssue({
      code: "custom",
      path: ["closedAt"],
      message: "Thời gian đóng phải sau thời gian mở",
    });
  }
}

export const tradeUpsertSchema = tradeUpsertBaseSchema.superRefine(
  ensureClosedAfterOpened,
);

export type TradeUpsertInput = z.infer<typeof tradeUpsertSchema>;

export const tradePatchSchema = tradeUpsertBaseSchema
  .partial()
  .superRefine(ensureClosedAfterOpened);
export type TradePatchInput = z.infer<typeof tradePatchSchema>;

export const tradeListQuerySchema = z.object({
  market: z.enum(MARKETS).optional(),
  status: z.enum(STATUSES).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  symbol: z.string().trim().min(1).max(40).optional(),
  strategyId: z.string().trim().min(1).max(64).optional(),
  from: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined))
    .refine((d) => d === undefined || !Number.isNaN(d.getTime()), {
      message: "from không hợp lệ",
    }),
  to: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined))
    .refine((d) => d === undefined || !Number.isNaN(d.getTime()), {
      message: "to không hợp lệ",
    }),
  cursor: z.string().trim().min(1).max(64).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((n) => n === undefined || (Number.isFinite(n) && n > 0 && n <= 200), {
      message: "limit phải từ 1 đến 200",
    }),
});
