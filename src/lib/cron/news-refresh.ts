/**
 * Hourly background news ingestion.
 *
 * The standalone /news page was removed; its manual "Làm mới" button was
 * the ONLY trigger populating the NewsArticle table, which feeds the
 * "Tin tức liên quan" card + AI context on the deep-analysis page and the
 * dashboard news card. This cron keeps that table alive.
 *
 * Summarization uses the global GEMINI_API_KEY — skip entirely when it's
 * absent. Per-user rows: refresh for every registered user (user counts
 * are small; revisit if this ever becomes multi-tenant at scale).
 */

import "server-only";
import { db } from "@/lib/db";
import { refreshNewsForUser } from "@/lib/news/service";

export async function runNewsRefreshForAllUsers(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) return;

  // Cost guard for public deployments: each user's refresh costs Gemini
  // summarization calls. Prioritize ENGAGED users (anyone with a connected
  // integration — broker or Telegram), cap the rest. Raise via env.
  const cap = Math.max(
    1,
    Number(process.env.NEWS_REFRESH_MAX_USERS) || 10,
  );

  let userIds: string[] = [];
  try {
    const engaged = await db.apiKey.findMany({
      where: { isActive: true },
      select: { userId: true },
      distinct: ["userId"],
    });
    const engagedIds = engaged.map((r) => r.userId);
    if (engagedIds.length < cap) {
      const rest = await db.user.findMany({
        where: { id: { notIn: engagedIds } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: cap - engagedIds.length,
      });
      userIds = [...engagedIds, ...rest.map((r) => r.id)];
    } else {
      userIds = engagedIds.slice(0, cap);
    }
  } catch (e) {
    console.error("[cron:news] user lookup failed", e);
    return;
  }

  for (const userId of userIds) {
    try {
      const summary = await refreshNewsForUser(userId);
      if (summary && typeof summary === "object") {
        // Keep the log line light — this runs hourly forever.
        console.log(
          `[cron:news] user=${userId} refreshed`,
          JSON.stringify(summary).slice(0, 200),
        );
      }
    } catch (e) {
      console.error(`[cron:news] user=${userId} failed`, e);
    }
  }
}
