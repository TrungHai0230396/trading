/**
 * Admin dashboard data. Everything the owner needs to eyeball the health of
 * the service in one server round-trip: user growth, activity, what's eating
 * storage, and cron heartbeats.
 */

import "server-only";
import { db } from "@/lib/db";
import { getHeartbeats, type Heartbeat } from "@/lib/cron/heartbeat";

export type AdminStats = {
  generatedAt: string;
  users: {
    total: number;
    new24h: number;
    new7d: number;
    new30d: number;
    withBroker: number;
    withTelegram: number;
    autotradeGranted: number;
  };
  activity: {
    tradesTotal: number;
    tradesOpen: number;
    brokerOrdersTotal: number;
    brokerOrdersByStatus: { status: string; count: number }[];
    watchlistSymbols: number;
    analysisRuns: number;
  };
  storage: {
    screenshots: number;
    screenshotBytes: number;
    dbBytes: number;
  };
  health: {
    dbOk: boolean;
    uptimeSec: number;
    crons: Heartbeat[];
  };
  recentUsers: {
    id: string;
    email: string;
    name: string | null;
    createdAt: string;
  }[];
};

function since(ms: number): Date {
  return new Date(Date.now() - ms);
}

/** Coerce a raw SQL SUM (bigint | Decimal | null) to a JS number. */
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return Number(v as number | bigint | string);
}

export async function getAdminStats(): Promise<AdminStats> {
  const DAY = 24 * 60 * 60_000;

  const [
    total,
    new24h,
    new7d,
    new30d,
    brokerUsers,
    telegramUsers,
    autotradeSettings,
    tradesTotal,
    tradesOpen,
    brokerOrdersTotal,
    ordersGrouped,
    watchlistSymbols,
    analysisRuns,
    screenshots,
    screenshotBytesRaw,
    dbBytesRaw,
    dbPing,
    recent,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: since(DAY) } } }),
    db.user.count({ where: { createdAt: { gte: since(7 * DAY) } } }),
    db.user.count({ where: { createdAt: { gte: since(30 * DAY) } } }),
    db.apiKey.findMany({
      where: { kind: { in: ["BITGET", "BINANCE"] } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.apiKey.findMany({
      where: { kind: "TELEGRAM" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.appSetting.findMany({
      where: { key: "feature:autotrade" },
      select: { value: true },
    }),
    db.tradeJournal.count(),
    db.tradeJournal.count({ where: { status: "OPEN" } }),
    db.brokerOrder.count(),
    db.brokerOrder.groupBy({ by: ["status"], _count: { _all: true } }),
    db.watchlistSymbol.count(),
    db.analysisRun.count(),
    db.tradeScreenshot.count(),
    db.$queryRaw<{ bytes: bigint | null }[]>`
      SELECT SUM(LENGTH(url)) AS bytes FROM TradeScreenshot`,
    db.$queryRaw<{ bytes: bigint | null }[]>`
      SELECT SUM(data_length + index_length) AS bytes
      FROM information_schema.tables
      WHERE table_schema = DATABASE()`,
    db
      .$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, email: true, name: true, createdAt: true },
    }),
  ]);

  const autotradeGranted = autotradeSettings.filter(
    (s) => (s.value as { enabled?: boolean } | null)?.enabled === true,
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    users: {
      total,
      new24h,
      new7d,
      new30d,
      withBroker: brokerUsers.length,
      withTelegram: telegramUsers.length,
      autotradeGranted,
    },
    activity: {
      tradesTotal,
      tradesOpen,
      brokerOrdersTotal,
      brokerOrdersByStatus: ordersGrouped
        .map((g) => ({ status: g.status as string, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      watchlistSymbols,
      analysisRuns,
    },
    storage: {
      screenshots,
      screenshotBytes: toNum(screenshotBytesRaw[0]?.bytes),
      dbBytes: toNum(dbBytesRaw[0]?.bytes),
    },
    health: {
      dbOk: dbPing,
      uptimeSec: Math.round(process.uptime()),
      crons: getHeartbeats(),
    },
    recentUsers: recent.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt.toISOString(),
    })),
  };
}
