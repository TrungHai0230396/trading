/**
 * Scheduled watchlist consensus scan → Telegram alert.
 *
 * Per-user configurable (Settings → Sàn giao dịch → Tín hiệu đồng thuận):
 *   - which timeframes must ALL agree (default 1h/4h/1d/1w),
 *   - notify on bullish and/or bearish consensus,
 *   - on/off switch.
 *
 * Coins watched = the user's CRYPTO watchlist (Phân tích AI page).
 *
 * Alerts fire on the TRANSITION into consensus only — per-symbol state is
 * kept in AppSetting, so a coin holding consensus for days alerts once.
 * Scans use public Binance data; no user credentials involved.
 */

import "server-only";
import { db } from "@/lib/db";
import { scanSymbol } from "@/lib/scanner/runner";
import { DEFAULT_STRATEGY } from "@/lib/scanner/strategies";
import { notifyUser } from "@/lib/notify/telegram";
import { getConsensusConfig } from "@/lib/notify/consensus-config";

const STATE_KEY = "alert:consensus-state";

/** symbol → last observed consensus direction. */
type ConsensusState = Record<string, "BULL" | "BEAR" | "NONE" | boolean>;

function normalizeState(v: ConsensusState[string]): "BULL" | "BEAR" | "NONE" {
  // Backward compat: the first version stored booleans (true = bullish).
  if (v === true) return "BULL";
  if (v === "BULL" || v === "BEAR") return v;
  return "NONE";
}

async function getState(userId: string): Promise<ConsensusState> {
  const row = await db.appSetting.findUnique({
    where: { userId_key: { userId, key: STATE_KEY } },
  });
  return (row?.value as ConsensusState) ?? {};
}

async function setState(userId: string, state: ConsensusState): Promise<void> {
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: STATE_KEY } },
    create: { userId, key: STATE_KEY, value: state },
    update: { value: state },
  });
}

export async function runConsensusScanForAllUsers(): Promise<void> {
  // Users who can actually receive the alert.
  let userIds: string[] = [];
  try {
    const rows = await db.apiKey.findMany({
      where: { kind: "TELEGRAM", isActive: true, label: null },
      select: { userId: true },
    });
    userIds = [...new Set(rows.map((r) => r.userId))];
  } catch (e) {
    console.error("[cron:consensus] user lookup failed", e);
    return;
  }

  for (const userId of userIds) {
    try {
      const config = await getConsensusConfig(userId);
      if (!config.enabled) continue;

      const watch = await db.watchlistSymbol.findMany({
        where: { userId, market: "CRYPTO" },
        select: { symbol: true },
      });
      if (watch.length === 0) continue;

      const state = await getState(userId);
      const nextState: ConsensusState = {};
      const newlyBull: string[] = [];
      const newlyBear: string[] = [];

      // Sequential per user — no reason to burst kline requests from a cron.
      for (const w of watch) {
        const symbol = w.symbol.toUpperCase();
        const prev = normalizeState(state[symbol]);
        try {
          const entry = await scanSymbol({
            runId: "cron",
            market: "CRYPTO",
            symbol,
            timeframes: config.timeframes,
            indicators: [DEFAULT_STRATEGY],
            limit: 300,
            persist: false,
          });
          const now: "BULL" | "BEAR" | "NONE" =
            entry.alignment === "BULLISH" &&
            entry.bullishCount === config.timeframes.length
              ? "BULL"
              : entry.alignment === "BEARISH" &&
                  entry.bearishCount === config.timeframes.length
                ? "BEAR"
                : "NONE";
          nextState[symbol] = now;
          if (now === "BULL" && prev !== "BULL" && config.notifyBullish) {
            newlyBull.push(symbol);
          }
          if (now === "BEAR" && prev !== "BEAR" && config.notifyBearish) {
            newlyBear.push(symbol);
          }
        } catch {
          // Transient scan failure — carry previous state forward so the
          // alert doesn't re-fire when the symbol comes back.
          nextState[symbol] = prev;
        }
      }

      const tfLabel = config.timeframes.join(" · ");
      const sections: string[] = [];
      if (newlyBull.length > 0) {
        sections.push(
          `📈 Đồng thuận BULLISH ${tfLabel}:\n${newlyBull.map((s) => `• ${s}`).join("\n")}`,
        );
      }
      if (newlyBear.length > 0) {
        sections.push(
          `📉 Đồng thuận BEARISH ${tfLabel}:\n${newlyBear.map((s) => `• ${s}`).join("\n")}`,
        );
      }
      if (sections.length > 0) {
        await notifyUser(
          userId,
          `${sections.join("\n\n")}\n\nXem chi tiết trong app → Quét đa khung.`,
        );
      }

      await setState(userId, nextState);
    } catch (e) {
      console.error(`[cron:consensus] user=${userId} failed`, e);
    }
  }
}
