/**
 * Per-user risk limits enforced at the order-placement route.
 *
 * Stored as one JSON blob in AppSetting under `risk:limits`. Defaults are
 * deliberately conservative for a small account; the user can widen them
 * in Settings → Sàn giao dịch.
 */

import "server-only";
import { db } from "@/lib/db";

export type RiskLimits = {
  /** Max risk per trade as % of futures equity (entry→SL distance × size). */
  maxRiskPct: number;
  /** Max simultaneously open positions (Bitget-wide, any symbol). */
  maxOpenPositions: number;
};

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxRiskPct: 5,
  maxOpenPositions: 3,
};

const KEY = "risk:limits";

export async function getRiskLimits(userId: string): Promise<RiskLimits> {
  const row = await db.appSetting.findUnique({
    where: { userId_key: { userId, key: KEY } },
  });
  if (!row) return DEFAULT_RISK_LIMITS;
  const v = row.value as Partial<RiskLimits>;
  const pct = Number(v.maxRiskPct);
  const pos = Number(v.maxOpenPositions);
  return {
    maxRiskPct:
      Number.isFinite(pct) && pct > 0 && pct <= 100
        ? pct
        : DEFAULT_RISK_LIMITS.maxRiskPct,
    maxOpenPositions:
      Number.isFinite(pos) && pos >= 1 && pos <= 50
        ? Math.floor(pos)
        : DEFAULT_RISK_LIMITS.maxOpenPositions,
  };
}

export async function setRiskLimits(
  userId: string,
  limits: RiskLimits,
): Promise<void> {
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: KEY } },
    create: { userId, key: KEY, value: limits },
    update: { value: limits },
  });
}
