/**
 * GET /api/health — public liveness/readiness probe.
 *
 * Deliberately UNAUTHENTICATED so an external uptime monitor (e.g.
 * UptimeRobot) can hit it every few minutes and alert the owner when the
 * whole box is down — something the in-process cron heartbeats can't do,
 * since a dead app can't report on itself.
 *
 * Leaks nothing sensitive: just liveness, a DB ping, and uptime. Returns
 * 503 when the DB is unreachable so the monitor flips to DOWN.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json(
    {
      ok: dbOk,
      db: dbOk ? "up" : "down",
      uptimeSec: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 },
  );
}
