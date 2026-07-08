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
const NEWS_INTERVAL_MS = 60 * 60_000;

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
  const { recordHeartbeat } = await import("@/lib/cron/heartbeat");

  // Wrap a cron in an overlap guard (a slow tick must not stack on itself)
  // + a heartbeat record so the admin page can show last-run/ok/duration.
  const guarded = (name: string, fn: () => Promise<unknown>) => {
    let running = false;
    return async () => {
      if (running) return;
      running = true;
      const startedAt = Date.now();
      try {
        await fn();
        recordHeartbeat(name, true, Date.now() - startedAt);
      } catch (e) {
        recordHeartbeat(
          name,
          false,
          Date.now() - startedAt,
          e instanceof Error ? e.message : String(e),
        );
        console.error(`[cron:${name}] tick failed`, e);
      } finally {
        running = false;
      }
    };
  };

  setInterval(guarded("broker-sync", runBrokerSyncForAllUsers), SYNC_INTERVAL_MS);
  setInterval(
    guarded("consensus-scan", runConsensusScanForAllUsers),
    CONSENSUS_INTERVAL_MS,
  );

  const { runNewsRefreshForAllUsers } = await import(
    "@/lib/cron/news-refresh"
  );
  const newsTick = guarded("news-refresh", runNewsRefreshForAllUsers);
  setInterval(newsTick, NEWS_INTERVAL_MS);
  // Prime once shortly after boot so a fresh deploy isn't news-empty for
  // a full hour.
  setTimeout(newsTick, 90_000);

  console.log(
    `[cron] started: broker-sync every ${SYNC_INTERVAL_MS / 60000}m, consensus-scan every ${CONSENSUS_INTERVAL_MS / 60000}m, news-refresh every ${NEWS_INTERVAL_MS / 60000}m`,
  );
}
