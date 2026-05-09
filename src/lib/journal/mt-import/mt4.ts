// MT4 "Detailed Report" HTML parser.
//
// MT4 exports a single HTML page. The "Closed Transactions" table has
// the columns:
//   Ticket | Open Time | Type | Size | Item | Price |
//   S/L | T/P | Close Time | Price (close) | Commission | Taxes |
//   Swap | Profit
//
// We:
//   * skip non-trade rows (`balance`, `credit`, `withdrawal`, etc.)
//   * accept rows where Type is `buy` / `sell` (sometimes `buy stop`,
//     `sell limit`, …, but for closed transactions MT4 reports only the
//     direction word)
//   * tolerate minor format drift (commas as thousand separators, extra
//     comments column appended at the end)

import {
  classifyMarket,
  parseMtDate,
  parseNumberCell,
  rowCells,
  splitRows,
  type ParsedTrade,
} from "./types";

/**
 * Find the section of the report that holds closed transactions. The
 * caption text varies a little by build/locale ("Closed Transactions:",
 * "Closed Trades:") so we look for either form. We slice to the next
 * caption-style row to stay scoped.
 */
function sliceClosedSection(html: string): string {
  const idx = html.search(/Closed\s+Transactions\s*:?/i);
  if (idx < 0) {
    // some MT4 builds use "Closed Trades:" — keep parsing on the whole doc
    return html;
  }
  // From the caption onwards, until the next "Open Trades" / "Working
  // Orders" / "Summary" heading. These captions are inside a `<td>` with
  // `colspan` on a single `<tr>`, so we look for the literal caption text.
  const stopRe = /(Open\s+Trades\s*:?|Working\s+Orders\s*:?|Summary|Closed\s+P\/L|Floating\s+P\/L|Open\s+Positions\s*:?)/i;
  const slice = html.slice(idx);
  const stop = slice.search(stopRe);
  // skip past the "Closed Transactions" caption itself (min 25 chars)
  const safeStop = stop > 30 ? stop : slice.length;
  return slice.slice(0, safeStop);
}

const TRADE_TYPES = new Set(["buy", "sell"]);
const SKIP_TYPES = new Set([
  "balance",
  "credit",
  "withdrawal",
  "deposit",
  "interest",
  "transfer",
  "correction",
]);

export function parseMt4Html(html: string): { trades: ParsedTrade[]; skipped: number } {
  const trades: ParsedTrade[] = [];
  let skipped = 0;

  const section = sliceClosedSection(html);
  const rows = splitRows(section);

  for (const rowInner of rows) {
    const cells = rowCells(rowInner);
    if (cells.length < 14) continue; // headers / sub-totals / captions

    const ticket = cells[0];
    const openTime = cells[1];
    const type = (cells[2] ?? "").toLowerCase();
    const size = cells[3];
    const item = cells[4];
    const price = cells[5];
    const sl = cells[6];
    const tp = cells[7];
    const closeTime = cells[8];
    const closePrice = cells[9];
    const commission = cells[10];
    // cells[11] = taxes (rarely used)
    const swap = cells[12];
    const profit = cells[13];

    // Type filter: skip non-trade ledger rows quietly (they aren't errors).
    if (SKIP_TYPES.has(type)) continue;
    if (!TRADE_TYPES.has(type)) {
      // e.g. could be a row whose first cell isn't a ticket number
      continue;
    }

    // Ticket should be numeric for MT4
    if (!/^\d+$/.test(ticket)) continue;

    const openedAt = parseMtDate(openTime);
    const closedAt = parseMtDate(closeTime);
    const lotSize = parseNumberCell(size);
    const entryPrice = parseNumberCell(price);
    const exitPrice = parseNumberCell(closePrice);
    const pnl = parseNumberCell(profit);

    if (
      Number.isNaN(openedAt.getTime()) ||
      Number.isNaN(closedAt.getTime()) ||
      !Number.isFinite(lotSize) ||
      !Number.isFinite(entryPrice) ||
      !Number.isFinite(exitPrice) ||
      !Number.isFinite(pnl)
    ) {
      skipped += 1;
      continue;
    }

    const slNum = parseNumberCell(sl);
    const tpNum = parseNumberCell(tp);
    const commissionNum = parseNumberCell(commission);
    const swapNum = parseNumberCell(swap);

    trades.push({
      externalTicket: ticket,
      symbol: item.toUpperCase(),
      market: classifyMarket(item),
      direction: type === "buy" ? "LONG" : "SHORT",
      lotSize,
      entryPrice,
      exitPrice,
      stopLoss: slNum > 0 ? slNum : undefined,
      takeProfit: tpNum > 0 ? tpNum : undefined,
      openedAt,
      closedAt,
      pnl,
      commission: Number.isFinite(commissionNum) ? commissionNum : undefined,
      swap: Number.isFinite(swapNum) ? swapNum : undefined,
    });
  }

  return { trades, skipped };
}
