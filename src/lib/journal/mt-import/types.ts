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
  // The file hit one of the work caps below, so the trade list is
  // incomplete. Callers MUST surface this instead of importing a partial
  // history — half a journal silently becomes wrong statistics.
  truncated: boolean;
};

// ──────────────────────────────────────────────────────────────────────
// Work caps
//
// The importer runs inside the same single Node process that serves every
// other user, so one crafted upload must never be able to buy unbounded
// CPU or memory. These ceilings sit far above any genuine MetaTrader
// statement: a very active year is a few hundred closed trades, and the
// caption slicing means only one report section is ever scanned.
// ──────────────────────────────────────────────────────────────────────

/** Max `<tr>` chunks scanned per report section. */
export const MAX_ROWS_PER_FILE = 20_000;

/** Max trades emitted from one file (also bounds the preview payload). */
export const MAX_TRADES_PER_FILE = 2_000;

/** MT tables top out around 14 columns; the rest is noise. */
const MAX_CELLS_PER_ROW = 64;

/**
 * Longest raw cell we bother stripping. Real cells are a few dozen chars;
 * without this a single crafted `<td>` could carry megabytes into the
 * parsed symbol/comment and back out through the JSON preview response.
 */
const MAX_CELL_CHARS = 1_024;

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

// ──────────────────────────────────────────────────────────────────────
// Tag scanning
//
// These used to be regexes of the shape `/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi`.
// That is quadratic on hostile input: given a body like `"<tr>".repeat(1e6)`
// with no closing tag, the engine restarts the lazy `[\s\S]*?` at every
// `<tr` position and each attempt walks to the end of the document. A few
// megabytes of that pegs the event loop — and because the whole app is one
// Node process, a single POST would freeze the site for every user. The
// scanners below only ever move an index forward, so they are linear.
// ──────────────────────────────────────────────────────────────────────

/** True when `ch` ends an HTML tag name (mirrors the old `\b` guard). */
function isTagNameEnd(ch: string | undefined): boolean {
  return (
    ch === undefined ||
    ch === ">" ||
    ch === "/" ||
    ch === " " ||
    ch === "\t" ||
    ch === "\n" ||
    ch === "\r" ||
    ch === "\f"
  );
}

/** Index of the next `</td` / `</th` at or after `from`, or -1. */
function findCellClose(lower: string, from: number): number {
  let i = from;
  while (i < lower.length) {
    const lt = lower.indexOf("</t", i);
    if (lt < 0) return -1;
    const kind = lower[lt + 3];
    if (kind === "d" || kind === "h") return lt;
    i = lt + 3; // e.g. `</table>` — keep moving forward
  }
  return -1;
}

/**
 * Split an HTML blob into raw `<tr>...</tr>` chunks. Forgiving — the
 * MT terminals close all tags, but malformed exports do happen. Stops at
 * `maxRows` and says so, rather than chewing through an arbitrary number
 * of rows.
 */
export function splitRows(
  html: string,
  maxRows: number = MAX_ROWS_PER_FILE,
): { rows: string[]; truncated: boolean } {
  const rows: string[] = [];
  const lower = html.toLowerCase(); // one pass, so indexOf can stay case-blind
  let i = 0;

  while (i < lower.length) {
    const open = lower.indexOf("<tr", i);
    if (open < 0) break;
    if (!isTagNameEnd(lower[open + 3])) {
      i = open + 3; // `<track>`, `<trx…` — not a row
      continue;
    }
    const gt = lower.indexOf(">", open + 3);
    if (gt < 0) break; // unterminated tag: nothing parseable is left
    const close = lower.indexOf("</tr", gt + 1);

    if (rows.length >= maxRows) return { rows, truncated: true };
    rows.push(html.slice(gt + 1, close < 0 ? html.length : close));

    if (close < 0) break; // last row was never closed — take what we have
    i = close + 4;
  }

  return { rows, truncated: false };
}

/**
 * Split a row into `<td>` cell texts (already stripped + trimmed).
 * Treats `<th>` as cells too so header rows can be detected.
 */
export function rowCells(rowInner: string): string[] {
  const cells: string[] = [];
  const lower = rowInner.toLowerCase();
  let i = 0;

  while (i < lower.length && cells.length < MAX_CELLS_PER_ROW) {
    const lt = lower.indexOf("<t", i);
    if (lt < 0) break;
    const kind = lower[lt + 2];
    if ((kind !== "d" && kind !== "h") || !isTagNameEnd(lower[lt + 3])) {
      i = lt + 2; // `<table>`, `<title>` — not a cell
      continue;
    }
    const gt = lower.indexOf(">", lt + 3);
    if (gt < 0) break;
    const close = findCellClose(lower, gt + 1);
    const end = close < 0 ? rowInner.length : close;

    cells.push(stripCellHtml(rowInner.slice(gt + 1, Math.min(end, gt + 1 + MAX_CELL_CHARS))));

    if (close < 0) break;
    i = end + 4;
  }

  return cells;
}
