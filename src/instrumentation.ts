/**
 * Next.js instrumentation hook — runs ONCE per server process start.
 *
 * We use it to start the in-process cron timers:
 *   - broker sync every 2 minutes (fill/close/cancel detection + Telegram)
 *   - watchlist 4-TF consensus scan every 15 minutes (Telegram alert)
 *
 * Single-container deployment makes in-process timers the simplest correct
 * choice: no extra worker, no duplicate-scheduler risk. If the app ever
 * scales to multiple instances, these must move to a dedicated worker or a
 * distributed lock.
 *
 * Disable with CRON_DISABLED=true (e.g. for one-off maintenance runs).
 */

const SYNC_INTERVAL_MS = 2 * 60_000;
const CONSENSUS_INTERVAL_MS = 15 * 60_000;

// Guard against double-registration (dev HMR re-runs register()).
declare global {
  // eslint-disable-next-line no-var
  var __trandingCronStarted: boolean | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CRON_DISABLED === "true") {
    console.log("[cron] disabled via CRON_DISABLED");
    return;
  }
  if (globalThis.__trandingCronStarted) return;
  globalThis.__trandingCronStarted = true;

  // Dynamic imports keep DB/server-only modules out of the edge bundle.
  const { runBrokerSyncForAllUsers } = await import(
    "@/lib/cron/broker-sync"
  );
  const { runConsensusScanForAllUsers } = await import(
    "@/lib/cron/consensus-scan"
  );

  // Overlap guards: a slow tick (Bitget latency, many users) must not stack
  // a second run on top of itself.
  let syncRunning = false;
  setInterval(async () => {
    if (syncRunning) return;
    syncRunning = true;
    try {
      await runBrokerSyncForAllUsers();
    } catch (e) {
      console.error("[cron:sync] tick failed", e);
    } finally {
      syncRunning = false;
    }
  }, SYNC_INTERVAL_MS);

  let scanRunning = false;
  setInterval(async () => {
    if (scanRunning) return;
    scanRunning = true;
    try {
      await runConsensusScanForAllUsers();
    } catch (e) {
      console.error("[cron:consensus] tick failed", e);
    } finally {
      scanRunning = false;
    }
  }, CONSENSUS_INTERVAL_MS);

  console.log(
    `[cron] started: broker-sync every ${SYNC_INTERVAL_MS / 60000}m, consensus-scan every ${CONSENSUS_INTERVAL_MS / 60000}m`,
  );
}
