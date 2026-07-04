/**
 * Forex (and forex-traded instruments) metadata.
 *
 * Conventions:
 *   - Currency pairs:
 *     · 1 standard lot = 100,000 base-currency units
 *     · JPY pairs: pip size = 0.01 (the 2nd decimal)
 *     · Most others: pip size = 0.0001 (the 4th decimal)
 *   - Metals (most MT4/MT5 brokers — Exness, Pepperstone, FXCM…):
 *     · XAUUSD: 1 lot = 100 oz, pip = 0.01, pip value = $1/lot
 *     · XAGUSD: 1 lot = 5,000 oz, pip = 0.001, pip value = $5/lot
 *
 * Different brokers can quote metals slightly differently (some call
 * 0.10 a "pip", some 0.01). We use the smallest tick = 1 pip rule
 * since that's what MT4's stops dialog displays.
 */

export type ForexPair = {
  symbol: string;        // EURUSD
  display: string;       // EUR/USD
  base: string;          // EUR
  quote: string;         // USD
  pipSize: number;
  digits: number;        // typical price decimals (5 for non-JPY, 3 for JPY)
  /** Base-currency units per 1 standard lot. 100,000 for FX, 100 for
   *  gold (XAU), 5,000 for silver (XAG). */
  lotUnits: number;
  group: "Major" | "Minor" | "Exotic" | "Metal";
};

export const ACCOUNT_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "NZD",
];

const isJpy = (symbol: string) => symbol.endsWith("JPY");

function make(
  base: string,
  quote: string,
  group: ForexPair["group"] = "Major",
): ForexPair {
  const symbol = `${base}${quote}`;
  return {
    symbol,
    display: `${base}/${quote}`,
    base,
    quote,
    pipSize: isJpy(symbol) ? 0.01 : 0.0001,
    digits: isJpy(symbol) ? 3 : 5,
    lotUnits: 100_000,
    group,
  };
}

/** Metal pair builder — different lot size + tick conventions than FX. */
function metal(
  base: "XAU" | "XAG",
  quote: string,
  opts: { pipSize: number; digits: number; lotUnits: number },
): ForexPair {
  return {
    symbol: `${base}${quote}`,
    display: `${base}/${quote}`,
    base,
    quote,
    pipSize: opts.pipSize,
    digits: opts.digits,
    lotUnits: opts.lotUnits,
    group: "Metal",
  };
}

export const FOREX_PAIRS: ForexPair[] = [
  // Majors
  make("EUR", "USD"),
  make("GBP", "USD"),
  make("USD", "JPY"),
  make("USD", "CHF"),
  make("USD", "CAD"),
  make("AUD", "USD"),
  make("NZD", "USD"),

  // EUR crosses
  make("EUR", "GBP", "Minor"),
  make("EUR", "JPY", "Minor"),
  make("EUR", "CHF", "Minor"),
  make("EUR", "AUD", "Minor"),
  make("EUR", "CAD", "Minor"),
  make("EUR", "NZD", "Minor"),

  // GBP crosses
  make("GBP", "JPY", "Minor"),
  make("GBP", "CHF", "Minor"),
  make("GBP", "AUD", "Minor"),
  make("GBP", "CAD", "Minor"),
  make("GBP", "NZD", "Minor"),

  // Other crosses
  make("AUD", "JPY", "Minor"),
  make("AUD", "CAD", "Minor"),
  make("AUD", "CHF", "Minor"),
  make("AUD", "NZD", "Minor"),
  make("CAD", "JPY", "Minor"),
  make("CAD", "CHF", "Minor"),
  make("CHF", "JPY", "Minor"),
  make("NZD", "JPY", "Minor"),
  make("NZD", "CAD", "Minor"),
  make("NZD", "CHF", "Minor"),

  // Metals — quoted in USD on most MT4/MT5 brokers
  metal("XAU", "USD", { pipSize: 0.01, digits: 2, lotUnits: 100 }),
  metal("XAG", "USD", { pipSize: 0.001, digits: 3, lotUnits: 5_000 }),
];

export const FOREX_PAIR_BY_SYMBOL: Record<string, ForexPair> = Object.fromEntries(
  FOREX_PAIRS.map((p) => [p.symbol, p]),
);

export function findForexPair(symbol: string): ForexPair | undefined {
  const normalized = symbol.toUpperCase().replace("/", "");
  return FOREX_PAIR_BY_SYMBOL[normalized];
}

/** "EURUSD" → "EUR/USD" (Twelve Data format). */
export function tdSymbol(symbol: string): string {
  const p = findForexPair(symbol);
  return p ? p.display : symbol;
}

/** Standard contract sizes (units of base currency per lot). */
export const LOT_UNITS = {
  standard: 100_000,
  mini: 10_000,
  micro: 1_000,
} as const;
