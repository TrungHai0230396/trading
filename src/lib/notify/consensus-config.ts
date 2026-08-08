/**
 * Per-user configuration for the Telegram alerts.
 *
 * Two independent groups live here:
 *   - the consensus alert (about COINS — timeframes, direction, on/off),
 *   - the personal DM prefs at the bottom (about the user's OWN journal).
 *
 * The cron scan reads the consensus half to decide WHICH timeframes must
 * agree and WHICH direction(s) to notify. Stored in AppSetting under
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

// ──────────────────────────────────────────────────────────────────────
// Personal DM prefs — messages about the user's OWN journal
// ──────────────────────────────────────────────────────────────────────
//
// Everything above notifies about coins. These two notify about the user's
// own recorded trades, so both default OFF and must be switched on in
// Settings: the only unsubscribe a user has is blocking the shared bot,
// which would also kill their scanner alerts. An unwanted DM therefore
// costs them a working feature, not just a tap.

const PERSONAL_KEY = "alert:personal-dm";

export type PersonalDmPrefs = {
  /** Weekly recap of the user's own closed trades (Monday morning, VN). */
  weeklyDigest: boolean;
};

/** Opt-IN: an absent row, and anything short of an explicit `true`, is OFF. */
function parsePersonalDmPrefs(value: unknown): PersonalDmPrefs {
  const v = (value ?? {}) as Partial<PersonalDmPrefs>;
  return {
    weeklyDigest: v.weeklyDigest === true,
  };
}

export async function getPersonalDmPrefs(
  userId: string,
): Promise<PersonalDmPrefs> {
  const row = await db.appSetting.findUnique({
    where: { userId_key: { userId, key: PERSONAL_KEY } },
  });
  return parsePersonalDmPrefs(row?.value);
}

/**
 * Batch variant for the crons: one query for the whole tick instead of one
 * per user. Users with no row are simply absent from the map (= defaults).
 */
export async function getPersonalDmPrefsMap(
  userIds: string[],
): Promise<Map<string, PersonalDmPrefs>> {
  const out = new Map<string, PersonalDmPrefs>();
  if (userIds.length === 0) return out;
  const rows = await db.appSetting.findMany({
    where: { key: PERSONAL_KEY, userId: { in: userIds } },
    select: { userId: true, value: true },
  });
  for (const r of rows) out.set(r.userId, parsePersonalDmPrefs(r.value));
  return out;
}

export async function setPersonalDmPrefs(
  userId: string,
  prefs: PersonalDmPrefs,
): Promise<void> {
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: PERSONAL_KEY } },
    create: { userId, key: PERSONAL_KEY, value: prefs },
    update: { value: prefs },
  });
}
