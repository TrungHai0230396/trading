// Shared types for the MT4 / MT5 HTML history importers.
//
// Both terminals export account history as a single HTML page with
// `<table>` rows. The parsers consume that text and emit a normalized
// `ParsedTrade[]`, ready to be turned into TradeJournal records.

export type ParsedBroker = "MT4" | "MT5";

export type ParsedMarket = "FOREX" | "CRYPTO" | "OTHER";

export type ParsedTrade = {
  externalTicket: string; // ticket / position id from the terminal
  symbol: string;
  market: ParsedMarket;
  direction: "LONG" | "SHORT";
  lotSize: number; // standard lots / units as reported by the terminal
  entryPrice: number;
  exitPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: Date;
  closedAt: Date;
  pnl: number; // net profit reported by the terminal
  commission?: number;
  swap?: number;
  comment?: string;
};

export type ParseResult = {
  broker: ParsedBroker;
  trades: ParsedTrade[];
  skipped: number;
};

// ──────────────────────────────────────────────────────────────────────
// Helpers shared by mt4 / mt5 parsers
// ──────────────────────────────────────────────────────────────────────

/**
 * Strip surrounding HTML tags + entities and collapse whitespace, leaving
 * the visible cell text.
 */
export function stripCellHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a number that may carry thousands separators (commas or spaces).
 * Returns NaN when the cell is empty or unparseable.
 */
export function parseNumberCell(raw: string): number {
  const cleaned = raw
    .replace(/\s+/g, "")
    .replace(/[^\d.\-]/g, ""); // drop currency symbols, commas, etc.
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parse an MT4/MT5 timestamp `YYYY.MM.DD HH:MM[:SS]` as UTC. We treat the
 * terminal-local time as UTC because we have no way to know the broker's
 * server zone — this keeps timestamps deterministic across users.
 */
export function parseMtDate(raw: string): Date {
  const m = raw
    .trim()
    .match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h, mi, s] = m;
  // Date.UTC takes month-1
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0")),
  );
}

/**
 * Detect whether a symbol looks like a 6-letter Forex pair (e.g. EURUSD)
 * or a known FX currency suffix. Anything else falls back to OTHER —
 * the user can re-classify by editing the trade afterwards.
 */
export function classifyMarket(symbol: string): ParsedMarket {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Common FX shape: 6 letters, all alpha, looks like XXXYYY.
  if (/^[A-Z]{6}$/.test(s)) {
    const fxQuotes = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"];
    const base = s.slice(0, 3);
    const quote = s.slice(3);
    if (fxQuotes.includes(base) || fxQuotes.includes(quote)) return "FOREX";
  }
  // Common crypto pairs end in USDT / BTC / ETH / USD when 6+ chars.
  if (/(USDT|USDC|BTC|ETH)$/.test(s)) return "CRYPTO";
  return "OTHER";
}

/**
 * Split an HTML blob into raw `<tr>...</tr>` chunks. Forgiving — the
 * MT terminals close all tags, but malformed exports do happen.
 */
export function splitRows(html: string): string[] {
  const rows: string[] = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    rows.push(m[1] ?? "");
  }
  return rows;
}

/**
 * Split a row into `<td>` cell texts (already stripped + trimmed).
 * Treats `<th>` as cells too so header rows can be detected.
 */
export function rowCells(rowInner: string): string[] {
  const cells: string[] = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowInner)) !== null) {
    cells.push(stripCellHtml(m[1] ?? ""));
  }
  return cells;
}
