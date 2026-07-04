/**
 * Per-user configuration for the consensus Telegram alert.
 *
 * The cron scan reads this to decide WHICH timeframes must agree and
 * WHICH direction(s) to notify. Stored in AppSetting under
 * `alert:consensus-config`; absent row = defaults (the original ask:
 * all of 1h/4h/1d/1w bullish).
 */

import "server-only";
import { db } from "@/lib/db";
import { isTimeframe, type Timeframe } from "@/lib/scanner/candles";

export type ConsensusConfig = {
  enabled: boolean;
  /** Timeframes that must ALL agree. 2..7 entries. */
  timeframes: Timeframe[];
  notifyBullish: boolean;
  notifyBearish: boolean;
};

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  enabled: true,
  timeframes: ["1h", "4h", "1d", "1w"],
  notifyBullish: true,
  notifyBearish: false,
};

const KEY = "alert:consensus-config";

export async function getConsensusConfig(
  userId: string,
): Promise<ConsensusConfig> {
  const row = await db.appSetting.findUnique({
    where: { userId_key: { userId, key: KEY } },
  });
  if (!row) return DEFAULT_CONSENSUS_CONFIG;
  const v = row.value as Partial<ConsensusConfig>;
  const tfs = Array.isArray(v.timeframes)
    ? v.timeframes.filter((t): t is Timeframe => typeof t === "string" && isTimeframe(t))
    : [];
  return {
    enabled: v.enabled !== false,
    timeframes:
      tfs.length >= 2 ? tfs : DEFAULT_CONSENSUS_CONFIG.timeframes,
    notifyBullish: v.notifyBullish !== false,
    notifyBearish: v.notifyBearish === true,
  };
}

export async function setConsensusConfig(
  userId: string,
  config: ConsensusConfig,
): Promise<void> {
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: KEY } },
    create: { userId, key: KEY, value: config },
    update: { value: config },
  });
}
