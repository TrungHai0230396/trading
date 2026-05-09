/**
 * Forex pair metadata. Standard Forex conventions:
 *   - JPY pairs: pip size = 0.01 (the 2nd decimal)
 *   - Most others: pip size = 0.0001 (the 4th decimal)
 *   - 1 standard lot = 100,000 base-currency units
 */

export type ForexPair = {
  symbol: string;        // EURUSD
  display: string;       // EUR/USD
  base: string;          // EUR
  quote: string;         // USD
  pipSize: number;
  digits: number;        // typical price decimals (5 for non-JPY, 3 for JPY)
  group: "Major" | "Minor" | "Exotic";
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
    group,
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
