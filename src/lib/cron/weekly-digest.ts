/**
 * Weekly digest — the one message the bot sends about the user's OWN
 * trading instead of somebody else's coin.
 *
 * Opt-in (default OFF, see PersonalDmPrefs). Sent once per ISO week from
 * Monday 08:00 Vietnam time, covering the previous Mon→Sun.
 *
 * Wall-clock, not elapsed time: a bare setInterval drifts off the slot and
 * loses its place on every restart, so this ticks often, asks "has this ISO
 * week passed its slot yet?", and remembers the last week it sent in
 * AppSetting — the same state-in-AppSetting shape consensus-scan uses.
 *
 * SILENT on a week with no closed trades. The only unsubscribe a user has
 * on the shared bot is blocking it, which would also kill their scanner
 * alerts — so a hollow "Tuần rồi: 0 lệnh" would cost them a working feature.
 *
 * Facts only: counts, R, P&L, fees, how many trades still lack notes. No
 * verdict, no advice. Money figures are summed from what the user actually
 * recorded and labelled with how many trades carried a number — never
 * estimated, never back-filled with zeros.
 *
 * Every number is a SQL aggregate over the WHOLE week, never a capped page of
 * rows added up in JS: a total that silently covers 500 of 600 closed trades
 * is a wrong money figure stated as fact, which this app does not do.
 */

import "server-only";
import { db } from "@/lib/db";
import { notifyUser, telegramEnabled } from "@/lib/notify/telegram";
import { getPersonalDmPrefsMap } from "@/lib/notify/consensus-config";

const STATE_KEY = "alert:weekly-digest";

/** Monday 08:00, Vietnam local time. */
const TARGET_DOW = 1; // 1 = Monday (ISO)
const TARGET_HOUR = 8;

const VN_OFFSET_MS = 7 * 3600_000;

/**
 * Give up after this many failed sends in one week. Without it a user who
 * blocked the bot (sendMessage keeps returning not-ok) would be retried
 * every tick for six days.
 */
const MAX_SEND_TRIES = 3;

type DigestState = {
  /** ISO week label this state refers to, e.g. "2026-W31". */
  week?: string;
  tries?: number;
  /** true = nothing more to do for `week` (sent, silent, or gave up). */
  done?: boolean;
};

// ──────────────────────────────────────────────────────────────────────
// Vietnam wall-clock helpers
// ──────────────────────────────────────────────────────────────────────

/** `now` shifted so the getUTC* accessors read as Vietnam wall-clock. */
function toVn(instant: Date): Date {
  return new Date(instant.getTime() + VN_OFFSET_MS);
}

/**
 * True once the current ISO week has reached its send slot.
 *
 * Deliberately "at or after the slot", not "inside a narrow window": the
 * digest stays due for the rest of the week. A box that is down at 08:00
 * Monday — a deploy, a reboot, a power cut — still sends when it comes
 * back, which a hit-the-minute window would silently skip forever.
 */
function pastTargetSlot(vn: Date): boolean {
  const dow = vn.getUTCDay() === 0 ? 7 : vn.getUTCDay(); // 1=Mon … 7=Sun
  if (dow > TARGET_DOW) return true;
  return dow === TARGET_DOW && vn.getUTCHours() >= TARGET_HOUR;
}

/** ISO-8601 week label ("2026-W31") of a VN-shifted date. */
function isoWeekKey(vn: Date): string {
  const d = new Date(
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()),
  );
  // Hop to the Thursday of the same ISO week — the day that names the year,
  // which is why late-December weeks can belong to the next year.
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 VN of the week containing `vn`, as a UTC instant. */
function vnWeekStartUtc(vn: Date): Date {
  const d = new Date(vn.getTime());
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - VN_OFFSET_MS);
}

/** "04/08" — a UTC instant rendered as a Vietnam calendar day. */
function vnDayMonth(instant: Date): string {
  const vn = toVn(instant);
  return `${String(vn.getUTCDate()).padStart(2, "0")}/${String(
    vn.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

// ──────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────

async function getStates(
  userIds: string[],
): Promise<Map<string, DigestState>> {
  const out = new Map<string, DigestState>();
  if (userIds.length === 0) return out;
  const rows = await db.appSetting.findMany({
    where: { key: STATE_KEY, userId: { in: userIds } },
    select: { userId: true, value: true },
  });
  for (const r of rows) {
    // Field-by-field rather than a blanket cast: a malformed row must not be
    // able to turn `tries` into NaN and disable the give-up counter.
    const v = (r.value ?? {}) as Record<string, unknown>;
    out.set(r.userId, {
      week: typeof v.week === "string" ? v.week : undefined,
      tries: typeof v.tries === "number" && v.tries >= 0 ? v.tries : 0,
      done: v.done === true,
    });
  }
  return out;
}

async function setState(userId: string, state: DigestState): Promise<void> {
  await db.appSetting.upsert({
    where: { userId_key: { userId, key: STATE_KEY } },
    create: { userId, key: STATE_KEY, value: state },
    update: { value: state },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Message
// ──────────────────────────────────────────────────────────────────────

const fmtMoney = (n: number): string =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const signed = (n: number): string => (n >= 0 ? `+${fmtMoney(n)}` : fmtMoney(n));

/** Public origin of the app; AUTH_URL is already required for login to work. */
function journalUrl(): string | null {
  const base = process.env.AUTH_URL?.replace(/\/+$/, "");
  return base ? `${base}/journal` : null;
}

/**
 * SUM() comes back as a Decimal, or null when no row carried a value.
 * null stays null all the way to the message — an unreadable sum is printed
 * as "—", never as 0.
 */
function sumToNumber(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/** null = nothing closed that week → send nothing at all. */
async function buildDigest(
  userId: string,
  from: Date,
  to: Date,
): Promise<string | null> {
  const closedInWeek = {
    userId,
    status: "CLOSED" as const,
    closedAt: { gte: from, lt: to },
  };

  const [totals, wins, losses, missingNotes, account] = await Promise.all([
    // Counted and summed by the database over the whole week — no LIMIT, so
    // no way for a busy week to be reported as a smaller one. `_count` on a
    // nullable column counts the rows that HAVE a value, which is exactly the
    // "trên N lệnh có ghi" label each money line carries.
    db.tradeJournal.aggregate({
      where: closedInWeek,
      _count: { _all: true, pnl: true, rMultiple: true, feesAmount: true },
      _sum: { pnl: true, rMultiple: true, feesAmount: true },
    }),
    db.tradeJournal.count({ where: { ...closedInWeek, pnl: { gt: 0 } } }),
    db.tradeJournal.count({ where: { ...closedInWeek, pnl: { lt: 0 } } }),
    // A whitespace-only note counts as written here (SQL has no trim through
    // Prisma). This line is a nudge to go journal, not a number to act on.
    db.tradeJournal.count({
      where: { ...closedInWeek, OR: [{ notes: null }, { notes: "" }] },
    }),
    db.tradingAccount.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { currency: true },
    }),
  ]);

  const total = totals._count._all;
  if (total === 0) return null;

  const currency = account?.currency ?? "USD";

  const pnlCount = totals._count.pnl;
  const pnlSum = sumToNumber(totals._sum.pnl);
  const rCount = totals._count.rMultiple;
  const rSum = sumToNumber(totals._sum.rMultiple);
  const feeCount = totals._count.feesAmount;
  const feeSum = sumToNumber(totals._sum.feesAmount);

  const lines: string[] = [`• Đã đóng: ${total} lệnh`];

  // Win/loss is a statement about trades that carry a real P/L. A trade with
  // no number recorded is neither, and must never be counted as a loss — the
  // "Chưa nhập P/L" line below is what accounts for the gap.
  if (pnlCount === 0) {
    // The app cannot know a money figure the user never typed.
    lines.push("• Tổng P/L: — (chưa lệnh nào có số P/L)");
  } else {
    // The counts come from separate queries, so clamp instead of trusting the
    // subtraction to stay positive if a row changed in between.
    const breakeven = Math.max(0, pnlCount - wins - losses);
    lines.push(
      `• Thắng / thua: ${wins} / ${losses}${
        breakeven > 0 ? ` / hoà ${breakeven}` : ""
      }`,
    );
    lines.push(
      pnlSum === null
        ? "• Tổng P/L: —"
        : `• Tổng P/L: ${signed(pnlSum)} ${currency}`,
    );
  }
  if (pnlCount < total) {
    lines.push(`• Chưa nhập P/L: ${total - pnlCount} lệnh`);
  }

  if (rCount === 0 || rSum === null) {
    lines.push("• Tổng R: — (chưa lệnh nào có R)");
  } else {
    lines.push(
      `• Tổng R: ${signed(rSum)}R${
        rCount < total ? ` (trên ${rCount} lệnh có R)` : ""
      }`,
    );
  }

  // Fee line only when a fee was actually recorded — a "0" here would read
  // as "you traded for free", which is not something the app knows.
  if (feeCount > 0 && feeSum !== null) {
    lines.push(
      `• Phí: ${fmtMoney(feeSum)} ${currency}${
        feeCount < total ? ` (trên ${feeCount} lệnh có ghi phí)` : ""
      }`,
    );
  }

  if (missingNotes > 0) {
    lines.push(`• Chưa có ghi chú: ${missingNotes} lệnh`);
  }

  const range = `${vnDayMonth(from)} – ${vnDayMonth(new Date(to.getTime() - 1))}`;
  const url = journalUrl();

  return [
    `📊 Nhật ký tuần rồi (${range})`,
    "",
    lines.join("\n"),
    "",
    url ? `Xem chi tiết: ${url}` : "Xem chi tiết trong app → Nhật ký.",
    "Tắt tin này: Cài đặt → Thông báo Telegram.",
  ].join("\n");
}

// ──────────────────────────────────────────────────────────────────────
// Tick
// ──────────────────────────────────────────────────────────────────────

export async function runWeeklyDigestForAllUsers(): Promise<void> {
  if (!telegramEnabled()) return;

  const now = new Date();
  const vn = toVn(now);
  // Cheap wall-clock gate first: the vast majority of ticks do zero DB work.
  if (!pastTargetSlot(vn)) return;
  const week = isoWeekKey(vn);

  let userIds: string[] = [];
  try {
    const rows = await db.user.findMany({
      where: { telegramChatId: { not: null } },
      select: { id: true },
    });
    userIds = rows.map((r) => r.id);
  } catch (e) {
    console.error("[cron:digest] user lookup failed", e);
    return;
  }
  if (userIds.length === 0) return;

  const prefs = await getPersonalDmPrefsMap(userIds);
  const optedIn = userIds.filter((id) => prefs.get(id)?.weeklyDigest === true);
  if (optedIn.length === 0) return;

  const states = await getStates(optedIn);
  const due = optedIn.filter((id) => {
    const st = states.get(id);
    return st?.week !== week || st?.done !== true;
  });
  if (due.length === 0) return;

  // The window is the FULL previous ISO week in Vietnam time, so a Sunday
  // evening trade lands in the digest the user gets the next morning.
  const thisWeekStart = vnWeekStartUtc(vn);
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86_400_000);

  for (const userId of due) {
    try {
      const prev = states.get(userId);
      // Attempt counter is per-week: a new week starts from zero.
      const tries = prev && prev.week === week ? (prev.tries ?? 0) : 0;

      const text = await buildDigest(userId, lastWeekStart, thisWeekStart);
      if (text === null) {
        // Silent week. Still recorded, so the rest of the week costs one
        // state read per tick instead of a journal query per tick.
        await setState(userId, { week, tries, done: true });
        continue;
      }

      const ok = await notifyUser(userId, text);
      const nextTries = tries + 1;
      await setState(userId, {
        week,
        tries: nextTries,
        done: ok || nextTries >= MAX_SEND_TRIES,
      });
      if (!ok) {
        console.warn(
          `[cron:digest] user=${userId} send failed (try ${nextTries}/${MAX_SEND_TRIES})`,
        );
      }
    } catch (e) {
      // A failure here must not skip the remaining users, and must not mark
      // the week done — the next tick retries.
      console.error(`[cron:digest] user=${userId} failed`, e);
    }
  }
}
