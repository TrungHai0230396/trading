import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { findForexPair } from "@/lib/calc/forex-pairs";
import { parseCryptoSymbol } from "@/lib/calc/crypto-symbols";
import {
  calcCryptoPosition,
  calcForexPosition,
} from "@/lib/calc/position-size";
import { getFxRate } from "@/lib/quotes/fx-rate";

const baseSchema = z.object({
  accountCurrency: z.string().length(3),
  direction: z.enum(["LONG", "SHORT"]),
  entryPrice: z.coerce.number().positive(),
  takeProfitPrice: z.coerce.number().positive().optional(),
  riskMode: z.enum(["percent", "fixed"]),
  riskValue: z.coerce.number().positive(),
  accountBalance: z.coerce.number().positive().optional(),
});

const forexSchema = baseSchema.extend({
  market: z.literal("FOREX"),
  symbol: z.string().min(6).max(7),
  stopMode: z.enum(["price", "pips"]),
  stopValue: z.coerce.number().positive(),
});

const cryptoSchema = baseSchema.extend({
  market: z.literal("CRYPTO"),
  symbol: z.string().min(3).max(20),
  stopPrice: z.coerce.number().positive(),
});

const requestSchema = z.discriminatedUnion("market", [forexSchema, cryptoSchema]);

/**
 * USDT/USDC are pegged to USD ≈ 1; treat them as USD for FX-rate lookups
 * so we don't fail when exchangerate.host doesn't recognize them.
 */
function normalizeForFxLookup(ccy: string): string {
  const c = ccy.toUpperCase();
  if (c === "USDT" || c === "USDC" || c === "BUSD" || c === "DAI") return "USD";
  return c;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    if (input.market === "FOREX") {
      const pair = findForexPair(input.symbol);
      if (!pair) {
        return NextResponse.json(
          { error: `Unknown forex pair "${input.symbol}".` },
          { status: 400 },
        );
      }

      const quoteToAccount =
        pair.quote === input.accountCurrency
          ? 1
          : await getFxRate(pair.quote, input.accountCurrency);

      const result = calcForexPosition({
        market: "FOREX",
        accountCurrency: input.accountCurrency,
        pair,
        direction: input.direction,
        entryPrice: input.entryPrice,
        stopMode: input.stopMode,
        stopValue: input.stopValue,
        takeProfitPrice: input.takeProfitPrice,
        riskMode: input.riskMode,
        riskValue: input.riskValue,
        accountBalance: input.accountBalance,
        quoteToAccountRate: quoteToAccount,
      });

      return NextResponse.json({
        ...result,
        meta: {
          symbol: pair.symbol,
          display: pair.display,
          pipSize: pair.pipSize,
          quoteCurrency: pair.quote,
          quoteToAccountRate: quoteToAccount,
        },
      });
    }

    // CRYPTO
    const meta = parseCryptoSymbol(input.symbol);
    const quoteForLookup = normalizeForFxLookup(meta.quote || "USD");
    const accountForLookup = normalizeForFxLookup(input.accountCurrency);

    const quoteToAccount =
      quoteForLookup === accountForLookup
        ? 1
        : await getFxRate(quoteForLookup, accountForLookup);

    const result = calcCryptoPosition({
      market: "CRYPTO",
      accountCurrency: input.accountCurrency,
      symbol: meta.symbol,
      base: meta.base,
      quote: meta.quote,
      direction: input.direction,
      entryPrice: input.entryPrice,
      stopPrice: input.stopPrice,
      takeProfitPrice: input.takeProfitPrice,
      riskMode: input.riskMode,
      riskValue: input.riskValue,
      accountBalance: input.accountBalance,
      quoteToAccountRate: quoteToAccount,
    });

    return NextResponse.json({
      ...result,
      meta: {
        symbol: meta.symbol,
        display: meta.display,
        quoteCurrency: meta.quote,
        quoteToAccountRate: quoteToAccount,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
