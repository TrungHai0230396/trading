// Sanity check for the MT4 / MT5 HTML parsers.
//
// Run with:
//   pnpm dlx tsx src/lib/journal/mt-import/__sanity__.ts
//
// Uses tiny inline HTML fixtures that mirror the real exports closely
// enough to exercise the column shape, the date format, and the broker
// auto-detection. If anything looks off the script prints a diff and
// exits with code 1.

import { parseMtHtml } from "./index";
import { parseMt4Html } from "./mt4";
import { parseMt5Html } from "./mt5";

const failures: string[] = [];

function expect(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ──────────────────────────────────────────────────────────────────
// MT4 fixture — Closed Transactions table row
// ──────────────────────────────────────────────────────────────────
const MT4_HTML = `
<html><body>
  <table>
    <tr><td colspan="14"><b>Account History</b></td></tr>
    <tr><td colspan="14"><b>Closed Transactions:</b></td></tr>
    <tr>
      <td>Ticket</td><td>Open Time</td><td>Type</td><td>Size</td>
      <td>Item</td><td>Price</td><td>S / L</td><td>T / P</td>
      <td>Close Time</td><td>Price</td><td>Commission</td>
      <td>Taxes</td><td>Swap</td><td>Profit</td>
    </tr>
    <tr>
      <td>123456</td><td>2024.05.01 10:00:00</td><td>buy</td><td>0.10</td>
      <td>EURUSD</td><td>1.07000</td><td>1.06800</td><td>1.07300</td>
      <td>2024.05.01 14:30:00</td><td>1.07150</td><td>-2.00</td>
      <td>0.00</td><td>-0.50</td><td>15.00</td>
    </tr>
    <tr>
      <td>123457</td><td>2024.05.02 09:00:00</td><td>sell</td><td>0.20</td>
      <td>XAUUSD</td><td>2300.50</td><td>2305.00</td><td>2290.00</td>
      <td>2024.05.02 11:00:00</td><td>2295.00</td><td>-4.00</td>
      <td>0.00</td><td>0.00</td><td>110.00</td>
    </tr>
    <tr>
      <td>999999</td><td>2024.05.03 00:00:00</td><td>balance</td><td></td>
      <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td>1000.00</td>
    </tr>
    <tr><td colspan="14"><b>Open Trades:</b></td></tr>
  </table>
</body></html>
`;

console.log("MT4 detailed report fixture:");
const mt4 = parseMt4Html(MT4_HTML);
expect("parsed two trades", mt4.trades.length === 2, `got ${mt4.trades.length}`);
expect("skipped no rows", mt4.skipped === 0, `skipped=${mt4.skipped}`);
expect(
  "first trade ticket",
  mt4.trades[0]?.externalTicket === "123456",
  String(mt4.trades[0]?.externalTicket),
);
expect(
  "first trade direction LONG",
  mt4.trades[0]?.direction === "LONG",
);
expect(
  "first trade symbol EURUSD",
  mt4.trades[0]?.symbol === "EURUSD",
);
expect(
  "first trade market FOREX",
  mt4.trades[0]?.market === "FOREX",
);
expect(
  "first trade entry 1.07",
  mt4.trades[0]?.entryPrice === 1.07,
  String(mt4.trades[0]?.entryPrice),
);
expect(
  "first trade pnl 15",
  mt4.trades[0]?.pnl === 15,
);
expect(
  "first trade commission -2",
  mt4.trades[0]?.commission === -2,
);
expect(
  "second trade SHORT",
  mt4.trades[1]?.direction === "SHORT",
);
expect(
  "second trade pnl 110",
  mt4.trades[1]?.pnl === 110,
);
expect(
  "balance row dropped",
  !mt4.trades.some((t) => t.externalTicket === "999999"),
);
expect(
  "openedAt parsed (UTC)",
  mt4.trades[0]?.openedAt.toISOString() === "2024-05-01T10:00:00.000Z",
  mt4.trades[0]?.openedAt.toISOString(),
);

// ──────────────────────────────────────────────────────────────────
// MT5 fixture — Positions section
// ──────────────────────────────────────────────────────────────────
const MT5_HTML = `
<html><body>
  <h2>Trading Account Statement</h2>
  <table>
    <tr><th colspan="13">Positions</th></tr>
    <tr>
      <th>Time</th><th>Position</th><th>Symbol</th><th>Type</th>
      <th>Volume</th><th>Price</th><th>S / L</th><th>T / P</th>
      <th>Time</th><th>Price</th><th>Commission</th><th>Swap</th>
      <th>Profit</th>
    </tr>
    <tr>
      <td>2024.06.10 08:15:00</td><td>555001</td><td>GBPUSD</td><td>buy</td>
      <td>0.50</td><td>1.27000</td><td>1.26500</td><td>1.28000</td>
      <td>2024.06.10 16:45:00</td><td>1.27500</td><td>-3.00</td>
      <td>-1.20</td><td>250.00</td>
    </tr>
    <tr>
      <td>2024.06.11 09:00:00</td><td>555002</td><td>BTCUSDT</td><td>sell</td>
      <td>0.10</td><td>70000.00</td><td>71000.00</td><td>68000.00</td>
      <td>2024.06.11 12:00:00</td><td>69500.00</td><td>0.00</td>
      <td>0.00</td><td>50.00</td>
    </tr>
    <tr><th colspan="13">Orders</th></tr>
  </table>
</body></html>
`;

console.log("\nMT5 statement fixture:");
const mt5 = parseMt5Html(MT5_HTML);
expect("parsed two positions", mt5.trades.length === 2, `got ${mt5.trades.length}`);
expect(
  "first position id 555001",
  mt5.trades[0]?.externalTicket === "555001",
);
expect(
  "GBPUSD classified FOREX",
  mt5.trades[0]?.market === "FOREX",
);
expect(
  "BTCUSDT classified CRYPTO",
  mt5.trades[1]?.market === "CRYPTO",
);
expect(
  "second direction SHORT",
  mt5.trades[1]?.direction === "SHORT",
);
expect(
  "first lotSize 0.5",
  mt5.trades[0]?.lotSize === 0.5,
);
expect(
  "first pnl 250",
  mt5.trades[0]?.pnl === 250,
);

// ──────────────────────────────────────────────────────────────────
// Auto-detect via parseMtHtml
// ──────────────────────────────────────────────────────────────────
console.log("\nAuto-detect:");
const detect4 = parseMtHtml(MT4_HTML);
expect("detect MT4", detect4.broker === "MT4", `got ${detect4.broker}`);
expect("detect MT4 trades", detect4.trades.length === 2);

const detect5 = parseMtHtml(MT5_HTML);
expect("detect MT5", detect5.broker === "MT5", `got ${detect5.broker}`);
expect("detect MT5 trades", detect5.trades.length === 2);

if (failures.length > 0) {
  console.error(`\n${failures.length} sanity assertion(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nAll sanity checks passed.");
