/**
 * Curated list of popular Binance USDT-quoted symbols.
 * The combobox lets the user type a custom symbol too.
 */

export type CryptoSymbol = {
  symbol: string;     // BTCUSDT
  display: string;    // BTC / USDT
  base: string;
  quote: string;
};

const POPULAR = [
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "LINK",
  "TON",
  "TRX",
  "MATIC",
  "DOT",
  "NEAR",
  "ATOM",
  "ARB",
  "OP",
  "SUI",
  "LTC",
  "BCH",
  "APT",
  "INJ",
  "FIL",
  "ICP",
  "TIA",
  "ETC",
  "HBAR",
  "RNDR",
  "PEPE",
  "WIF",
];

export const CRYPTO_QUOTES = ["USDT", "USD", "BTC", "ETH"];

export const POPULAR_CRYPTO: CryptoSymbol[] = POPULAR.map((b) => ({
  symbol: `${b}USDT`,
  display: `${b} / USDT`,
  base: b,
  quote: "USDT",
}));

export function parseCryptoSymbol(raw: string): CryptoSymbol {
  const symbol = raw.toUpperCase().replace("/", "");
  const knownQuote = CRYPTO_QUOTES.find((q) => symbol.endsWith(q));
  if (knownQuote) {
    const base = symbol.slice(0, symbol.length - knownQuote.length);
    return {
      symbol,
      display: `${base} / ${knownQuote}`,
      base,
      quote: knownQuote,
    };
  }
  return { symbol, display: symbol, base: symbol, quote: "" };
}
