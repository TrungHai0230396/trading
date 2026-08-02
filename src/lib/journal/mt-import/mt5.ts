// MT5 Statement HTML parser.
//
// MT5 reports include a `Positions` table whose columns are:
//   Time | Position | Symbol | Type | Volume | Price | S/L | T/P |
//   Time (close) | Price (close) | Commission | Swap | Profit
//
// Some MT5 reports omit Positions and only emit a `Deals` table. This
// parser supports the Positions form (which covers the standard
// "Report → HTML" export). Deals-only reports would need pairing of
// IN/OUT deals by position id — a known limitation, called out in the
// final report.

import {
  classifyMarket,
  MAX_TRADES_PER_FILE,
  parseMtDate,
  parseNumberCell,
  rowCells,
  splitRows,
  type ParsedTrade,
} from "./types";

const TRADE_TYPES = new Set(["buy", "sell"]);

/**
 * Slice the document around the `Positions` heading so we don't pick up
 * Deals/Orders rows by accident.
 */
function slicePositionsSection(html: string): string {
  const idx = html.search(/>\s*Positions\s*</i);
  if (idx < 0) return html;
  const slice = html.slice(idx);
  const stop = slice.search(/>\s*(Orders|Deals|Results|Summary)\s*</i);
  // skip past the Positions caption itself
  return stop > 30 ? slice.slice(0, stop) : slice;
}

export function parseMt5Html(html: string): {
  trades: ParsedTrade[];
  skipped: number;
  truncated: boolean;
} {
  const trades: ParsedTrade[] = [];
  let skipped = 0;

  const section = slicePositionsSection(html);
  const { rows, truncated: rowsTruncated } = splitRows(section);
  let truncated = rowsTruncated;

  for (const rowInner of rows) {
    // Same ceiling as MT4 — see the note there.
    if (trades.length >= MAX_TRADES_PER_FILE) {
      truncated = true;
      break;
    }

    const cells = rowCells(rowInner);
    if (cells.length < 13) continue;

    const openTime = cells[0];
    const positionId = cells[1];
    const symbol = cells[2];
    const type = (cells[3] ?? "").toLowerCase();
    const volume = cells[4];
    const price = cells[5];
    const sl = cells[6];
    const tp = cells[7];
    const closeTime = cells[8];
    const closePrice = cells[9];
    const commission = cells[10];
    const swap = cells[11];
    const profit = cells[12];

    if (!TRADE_TYPES.has(type)) continue;
    if (!/^\d+$/.test(positionId)) continue;

    const openedAt = parseMtDate(openTime);
    const closedAt = parseMtDate(closeTime);
    const lotSize = parseNumberCell(volume);
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
      externalTicket: positionId,
      symbol: symbol.toUpperCase(),
      market: classifyMarket(symbol),
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

  return { trades, skipped, truncated };
}
