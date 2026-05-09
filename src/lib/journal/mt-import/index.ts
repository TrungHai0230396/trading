// MT4 / MT5 HTML import — public surface.
//
// `parseMtHtml` auto-detects the broker by looking for telltale captions
// in the document, then delegates to the matching parser. We err on the
// side of MT5 when both signals appear (e.g. a custom export wrapping
// both reports) since MT5 is the newer terminal.

import { parseMt4Html } from "./mt4";
import { parseMt5Html } from "./mt5";
import type { ParseResult } from "./types";

export type { ParsedBroker, ParsedMarket, ParsedTrade, ParseResult } from "./types";

const MT5_HINTS = [
  /Trading\s+Account\s+Statement/i, // MT5 statement title
  />\s*Positions\s*</i,
  />\s*Deals\s*</i,
  />\s*Orders\s*</i,
];

const MT4_HINTS = [
  /Closed\s+Transactions\s*:?/i,
  /Detailed\s+Statement/i,
  /Account\s+History/i, // common MT4 caption
];

function detectBroker(html: string): "MT4" | "MT5" {
  let mt5Score = 0;
  let mt4Score = 0;
  for (const re of MT5_HINTS) if (re.test(html)) mt5Score += 1;
  for (const re of MT4_HINTS) if (re.test(html)) mt4Score += 1;
  // The Positions caption is a strong MT5 signal even when MT4-style
  // captions also appear in a hybrid export.
  if (/>\s*Positions\s*</i.test(html) && /Symbol/i.test(html)) return "MT5";
  return mt5Score > mt4Score ? "MT5" : "MT4";
}

export function parseMtHtml(html: string): ParseResult {
  const broker = detectBroker(html);
  const { trades, skipped } =
    broker === "MT5" ? parseMt5Html(html) : parseMt4Html(html);
  return { broker, trades, skipped };
}
