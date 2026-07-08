/**
 * In-process cron heartbeats.
 *
 * The crons run inside the same Node process as the server (see
 * instrumentation.ts), so a module-level store is readable by the admin
 * page without any DB round-trip. This mirrors the rate-limiter's design:
 * single-container, per-process. It resets on restart — the admin page
 * labels the numbers "kể từ lần khởi động gần nhất" so that's not misleading.
 *
 * If the app ever goes multi-instance, move this to a shared store (DB/Redis)
 * along with the crons themselves.
 */

export type Heartbeat = {
  name: string;
  /** epoch ms of the last completed run (success or failure). */
  lastRunAt: number;
  ok: boolean;
  durationMs: number;
  /** total ticks since process start. */
  runs: number;
  errors: number;
  lastError?: string;
};

const beats = new Map<string, Heartbeat>();

export function recordHeartbeat(
  name: string,
  ok: boolean,
  durationMs: number,
  error?: string,
): void {
  const prev = beats.get(name);
  beats.set(name, {
    name,
    lastRunAt: Date.now(),
    ok,
    durationMs,
    runs: (prev?.runs ?? 0) + 1,
    errors: (prev?.errors ?? 0) + (ok ? 0 : 1),
    lastError: ok ? prev?.lastError : error,
  });
}

export function getHeartbeats(): Heartbeat[] {
  return [...beats.values()].sort((a, b) => a.name.localeCompare(b.name));
}
