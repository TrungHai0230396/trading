/**
 * Scheduled watchlist consensus scan → Telegram alert.
 *
 * Per-user configurable (Quét đa khung → Watchlist → Khung mặc định & hướng báo):
 *   - which timeframes must ALL agree (default 1h/4h/1d/1w),
 *   - notify on bullish and/or bearish consensus,
 *   - on/off switch.
 *
 * Coins watched = the user's CRYPTO watchlist (managed on the Scanner page).
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
import {
  getConsensusConfig,
  getTfOverrides,
} from "@/lib/notify/consensus-config";

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
  // Users who can actually receive the alert — those who linked the system
  // Telegram bot (telegramChatId set).
  let userIds: string[] = [];
  try {
    const rows = await db.user.findMany({
      where: { telegramChatId: { not: null } },
      select: { id: true },
    });
    userIds = rows.map((r) => r.id);
  } catch (e) {
    console.error("[cron:consensus] user lookup failed", e);
    return;
  }

  for (const userId of userIds) {
    try {
      const config = await getConsensusConfig(userId);
      if (!config.enabled) continue;

      const [watch, overrides] = await Promise.all([
        db.watchlistSymbol.findMany({
          where: { userId, market: "CRYPTO" },
          select: { symbol: true },
          // Defensive bound matching the API-side cap (50/user): one
          // oversized list must never stall the shared 15-minute tick —
          // and with it every user's alerts.
          orderBy: { createdAt: "asc" },
          take: 50,
        }),
        getTfOverrides(userId),
      ]);
      if (watch.length === 0) continue;

      const state = await getState(userId);
      const nextState: ConsensusState = {};
      // Each alert line self-describes its coin's timeframes (per-coin
      // overrides mean there's no single shared TF label anymore).
      const newlyBull: string[] = [];
      const newlyBear: string[] = [];
      const brokenBull: string[] = [];
      const brokenBear: string[] = [];

      // Sequential per user — no reason to burst kline requests from a cron.
      for (const w of watch) {
        const symbol = w.symbol.toUpperCase();
        // Per-coin timeframes: the coin's override if set, else the global.
        const tfs = overrides[symbol] ?? config.timeframes;
        const tfLabel = tfs.join("·");
        // First observation of a freshly-followed coin is a BASELINE, not a
        // signal: the user just saw its state when they followed it (e.g.
        // tapped 🔔 on an already-bullish Top-10 row). Record silently;
        // alert only on CHANGES after this point.
        // State is keyed by symbol + its TF set so changing a coin's
        // override re-baselines it instead of firing a spurious break.
        const stateKey = `${symbol}@${tfLabel}`;
        const isNew = !(stateKey in state);
        const prev = normalizeState(state[stateKey]);
        try {
          const entry = await scanSymbol({
            runId: "cron",
            market: "CRYPTO",
            symbol,
            timeframes: tfs,
            indicators: [DEFAULT_STRATEGY],
            limit: 300,
            persist: false,
            // The one true background caller: this tick drives everyone's
            // Telegram consensus alerts, and if it queues behind interactive
            // traffic it runs long, the overlap guard swallows the next tick,
            // and alerts stop firing with no error anywhere.
            priority: "background",
          });
          // scanSymbol swallows a per-TF kline failure as a NEUTRAL entry
          // with `.error` set — which would drop bullishCount below the
          // threshold and fire a FALSE "lost consensus" break. If ANY TF
          // errored the scan is inconclusive: carry prev state, no alert.
          if (entry.perTF.some((t) => t.error)) {
            if (!isNew) nextState[stateKey] = prev;
            continue;
          }
          const now: "BULL" | "BEAR" | "NONE" =
            entry.alignment === "BULLISH" && entry.bullishCount === tfs.length
              ? "BULL"
              : entry.alignment === "BEARISH" &&
                  entry.bearishCount === tfs.length
                ? "BEAR"
                : "NONE";
          nextState[stateKey] = now;
          if (isNew) continue; // baseline recorded, no alert

          const label = `${symbol} [${tfs.join("·")}]`;
          // Entry into consensus.
          if (now === "BULL" && prev !== "BULL" && config.notifyBullish) {
            newlyBull.push(label);
          }
          if (now === "BEAR" && prev !== "BEAR" && config.notifyBearish) {
            newlyBear.push(label);
          }
          // Break of a consensus we previously observed — the exit signal.
          if (config.notifyBreak) {
            if (prev === "BULL" && now !== "BULL" && config.notifyBullish) {
              brokenBull.push(
                `${symbol} (còn ${entry.bullishCount}/${tfs.length} khung bullish)`,
              );
            }
            if (prev === "BEAR" && now !== "BEAR" && config.notifyBearish) {
              brokenBear.push(
                `${symbol} (còn ${entry.bearishCount}/${tfs.length} khung bearish)`,
              );
            }
          }
        } catch {
          // Transient scan failure — carry previous state forward so the
          // alert doesn't re-fire when the symbol comes back.
          if (!isNew) nextState[stateKey] = prev;
        }
      }

      const sections: string[] = [];
      if (newlyBull.length > 0) {
        sections.push(
          `📈 Đồng thuận BULLISH:\n${newlyBull.map((s) => `• ${s}`).join("\n")}`,
        );
      }
      if (newlyBear.length > 0) {
        sections.push(
          `📉 Đồng thuận BEARISH:\n${newlyBear.map((s) => `• ${s}`).join("\n")}`,
        );
      }
      if (brokenBull.length > 0) {
        sections.push(
          `⚠️ MẤT đồng thuận bullish — cân nhắc lại vị thế:\n${brokenBull.map((s) => `• ${s}`).join("\n")}`,
        );
      }
      if (brokenBear.length > 0) {
        sections.push(
          `⚠️ MẤT đồng thuận bearish:\n${brokenBear.map((s) => `• ${s}`).join("\n")}`,
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
