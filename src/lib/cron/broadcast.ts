/**
 * Broadcast cron (kiểu B) — posts the global Top consensus to the public
 * Telegram channel a few times a day. Everyone who joins the channel sees
 * the same signal; no per-user linking needed.
 *
 * No-op unless BOTH TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID are set, so
 * it costs nothing until the owner wires up a channel.
 */

import "server-only";
import { db } from "@/lib/db";
import { adminEmails } from "@/lib/admin";
import { broadcastToChannel, telegramEnabled } from "@/lib/notify/telegram";
import { runScan } from "@/lib/scanner/runner";
import { DEFAULT_STRATEGY } from "@/lib/scanner/strategies";

const TFS = ["1h", "4h", "1d", "1w"];

export async function runConsensusBroadcast(): Promise<void> {
  if (!telegramEnabled() || !process.env.TELEGRAM_CHANNEL_ID) return;

  // runScan persists an AnalysisRun under a user — attribute it to the owner.
  const emails = adminEmails();
  const owner =
    emails.length > 0
      ? await db.user.findFirst({
          where: { email: { in: emails } },
          select: { id: true },
        })
      : null;
  if (!owner) return;

  const result = await runScan({
    userId: owner.id,
    market: "CRYPTO",
    symbols: [],
    timeframes: TFS,
    indicators: [DEFAULT_STRATEGY],
    includeConsensusTop: true,
    name: "Broadcast",
  });

  const top = result.consensusTop;
  if (!top) return;
  const bull = top.bullish.slice(0, 8);
  const bear = top.bearish.slice(0, 8);
  if (bull.length === 0 && bear.length === 0) return;

  const fmt = (s: { symbol: string; score: number }) =>
    `• ${s.symbol} (${s.score.toFixed(0)})`;

  const parts: string[] = [
    `📡 <b>Vela — Top đồng thuận đa khung</b>`,
    `Đồng thuận cả ${TFS.join(" · ")}`,
  ];
  if (bull.length > 0) {
    parts.push(`\n📈 BULLISH\n${bull.map(fmt).join("\n")}`);
  }
  if (bear.length > 0) {
    parts.push(`\n📉 BEARISH\n${bear.map(fmt).join("\n")}`);
  }
  parts.push(`\n⚠️ Không phải lời khuyên đầu tư.`);

  // Plain-text send (sendToChat doesn't set parse_mode) — strip the <b> tags
  // we optimistically added so they don't show literally.
  await broadcastToChannel(parts.join("\n").replace(/<\/?b>/g, ""));
}
