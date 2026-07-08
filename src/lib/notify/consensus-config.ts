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
  /** Timeframes that must ALL agree. 1..7 entries (1 = single-TF signal alert). */
  timeframes: Timeframe[];
  notifyBullish: boolean;
  notifyBearish: boolean;
  /**
   * Alert when a followed coin LOSES a consensus it previously had — the
   * exit signal. This is what makes following an already-consensus coin
   * meaningful: you're watching for the break, not the (already seen)
   * entry.
   */
  notifyBreak: boolean;
};

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  enabled: true,
  timeframes: ["1h", "4h", "1d", "1w"],
  notifyBullish: true,
  notifyBearish: false,
  notifyBreak: true,
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
      tfs.length >= 1 ? tfs : DEFAULT_CONSENSUS_CONFIG.timeframes,
    notifyBullish: v.notifyBullish !== false,
    notifyBearish: v.notifyBearish === true,
    // Default ON — break alerts are the point of following consensus coins.
    notifyBreak: v.notifyBreak !== false,
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

// ──────────────────────────────────────────────────────────────────────
// Per-coin timeframe overrides
// ──────────────────────────────────────────────────────────────────────
//
// A coin without an override uses the global config.timeframes. An entry
// here (>=1 valid TF) replaces the default for THAT symbol only — lets
// the user watch e.g. BTC on 1h/4h but ETH on 1d/1w. Stored as one map so
// the cron reads it in a single query.

const OVERRIDE_KEY = "alert:tf-overrides";

export type TfOverrides = Record<string, Timeframe[]>;

function sanitizeTfs(v: unknown): Timeframe[] | null {
  if (!Array.isArray(v)) return null;
  const valid = v.filter(
    (t): t is Timeframe => typeof t === "string" && isTimeframe(t),
  );
  const uniq = [...new Set(valid)];
  return uniq.length >= 1 ? uniq : null;
}

export async function getTfOverrides(userId: string): Promise<TfOverrides> {
  const row = await db.appSetting.findUnique({
    where: { userId_key: { userId, key: OVERRIDE_KEY } },
  });
  const raw = (row?.value as Record<string, unknown>) ?? {};
  const out: TfOverrides = {};
  for (const [sym, tfs] of Object.entries(raw)) {
    const clean = sanitizeTfs(tfs);
    if (clean) out[sym.toUpperCase()] = clean;
  }
  return out;
}

/** Set (>=1 TF) or clear (null / empty) the override for one symbol. */
export async function setTfOverride(
  userId: string,
  symbol: string,
  timeframes: Timeframe[] | null,
): Promise<void> {
  const current = await getTfOverrides(userId);
  const key = symbol.toUpperCase();
  const clean = timeframes === null ? null : sanitizeTfs(timeframes);
  if (clean) current[key] = clean;
  else delete current[key];
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: OVERRIDE_KEY } },
    create: { userId, key: OVERRIDE_KEY, value: current },
    update: { value: current },
  });
}
