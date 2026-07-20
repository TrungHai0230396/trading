/**
 * Thin server wrapper that pulls the cached snapshot and hands the
 * relevant fields to the (client) ActionBar. Lives separately from
 * DataCards so the bar can be rendered at the BOTTOM of the page —
 * after the AI narrative — and stick to the bottom of the viewport on
 * mobile without being sandwiched between cards.
 *
 * Uses the same `getCachedAnalysisSnapshot` so it's deduped within the
 * request (React `cache()` makes both this and DataCards share one
 * snapshot fetch).
 */

import { getCachedAnalysisSnapshot } from "@/lib/analysis/snapshot";

import { ActionBar } from "./action-bar";

type Args = readonly [
  string,
  "CRYPTO" | "FOREX",
  string,
  number | undefined,
  number | undefined,
];

export async function ActionBarShell({ args }: { args: Args }) {
  const snap = await getCachedAnalysisSnapshot(...args);
  return (
    <ActionBar
      verdict={snap.recommendation.verdict}
      tradePlan={snap.tradePlan}
      symbol={snap.symbol}
      base={snap.base}
      market={snap.market}
      accountBalance={snap.accountBalance}
      initialInWatchlist={snap.userContext.inWatchlist}
    />
  );
}
