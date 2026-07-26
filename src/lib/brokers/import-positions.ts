/**
 * Read-only import of OPEN positions from every connected exchange into the
 * user's trading journal.
 *
 * For each connected broker (Bitget / Binance / MEXC) we read the live open
 * positions (getOpenPositions — a pure READ) and upsert one journal entry per
 * position, keyed by `brokerRef = "<BROKER>:<SYMBOL>:<SIDE>"`. Re-syncing
 * UPDATES the same entry (refreshes entry price + size) instead of creating a
 * duplicate; the user's own notes/setup/SL/TP/strategy are never touched.
 *
 * Scope (v1): OPEN positions only. Closed-trade history / realized PnL is a
 * separate, harder job (per-symbol on Binance) and is intentionally out.
 *
 * Never writes to any exchange. One broker failing (e.g. a spot-only MEXC key
 * with no Futures permission) degrades to a per-broker error; the others still
 * import.
 */

import "server-only";
import { db } from "@/lib/db";
import { loadCreds } from "@/lib/brokers/store";
import {
  getOpenPositions as bitgetOpenPositions,
  BitgetError,
  type BitgetCreds,
  type BitgetPosition,
} from "@/lib/brokers/bitget";
import {
  getOpenPositions as binanceOpenPositions,
  BinanceError,
  type BinanceCreds,
} from "@/lib/brokers/binance";
import {
  getOpenPositions as mexcOpenPositions,
  MexcError,
  type MexcCreds,
} from "@/lib/brokers/mexc";
import {
  getOpenPositions as okxOpenPositions,
  OkxError,
  type OkxCreds,
} from "@/lib/brokers/okx";

type BrokerName = "BITGET" | "BINANCE" | "MEXC" | "OKX";

const LABEL: Record<BrokerName, string> = {
  BITGET: "Bitget",
  BINANCE: "Binance",
  MEXC: "MEXC",
  OKX: "OKX",
};

export type ImportResult = {
  created: number;
  updated: number;
  byBroker: Array<{ broker: BrokerName; open: number; error?: string }>;
};

/** Prisma unique-constraint violation (duck-typed to avoid importing the
 *  generated error class). */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}

function errText(broker: BrokerName, e: unknown): string {
  if (
    e instanceof BitgetError ||
    e instanceof BinanceError ||
    e instanceof MexcError ||
    e instanceof OkxError
  ) {
    return e.toVietnamese();
  }
  if (e instanceof Error && e.name === "TimeoutError") {
    return `${LABEL[broker]} không phản hồi kịp.`;
  }
  return e instanceof Error ? e.message : "Lỗi không xác định";
}

export async function importOpenPositions(userId: string): Promise<ImportResult> {
  const [bitget, binance, mexc, okx] = await Promise.all([
    loadCreds<BitgetCreds>(userId, "BITGET"),
    loadCreds<BinanceCreds>(userId, "BINANCE"),
    loadCreds<MexcCreds>(userId, "MEXC"),
    loadCreds<OkxCreds>(userId, "OKX"),
  ]);

  const byBroker: ImportResult["byBroker"] = [];
  let created = 0;
  let updated = 0;

  const runOne = async (
    broker: BrokerName,
    fetcher: () => Promise<BitgetPosition[]>,
  ): Promise<void> => {
    let positions: BitgetPosition[];
    try {
      positions = await fetcher();
    } catch (e) {
      byBroker.push({ broker, open: 0, error: errText(broker, e) });
      return;
    }
    let writeError: string | undefined;
    for (const p of positions) {
      // getOpenPositions already filters size≠0; guard the price too so a
      // bad row can never write a nonsense entryPrice into the journal.
      if (!(p.size > 0) || !(p.entryPrice > 0)) continue;
      const direction: "LONG" | "SHORT" = p.side === "long" ? "LONG" : "SHORT";
      const brokerRef = `${broker}:${p.symbol}:${p.side}`;
      // Refresh the objective facts only — never the user's notes/setup/SL/TP.
      const updateData = {
        entryPrice: p.entryPrice,
        lotSize: p.size,
        direction,
        status: "OPEN" as const,
      };

      try {
        const existing = await db.tradeJournal.findUnique({
          where: { userId_brokerRef: { userId, brokerRef } },
          select: { id: true },
        });
        if (existing) {
          await db.tradeJournal.update({ where: { id: existing.id }, data: updateData });
          updated += 1;
        } else {
          try {
            await db.tradeJournal.create({
              data: {
                userId,
                symbol: p.symbol,
                market: "CRYPTO",
                openedAt: new Date(),
                source: "BROKER",
                brokerRef,
                notes: `Nhập tự động từ ${LABEL[broker]} · đòn bẩy ${
                  p.leverage || "?"
                }x (chỉ đọc — cập nhật khi bấm Đồng bộ sàn).`,
                ...updateData,
              },
            });
            created += 1;
          } catch (e) {
            // A concurrent sync (auto-on-mount + poll + manual click can
            // overlap) may have created this same row first → unique
            // violation. Fall back to an update instead of crashing.
            if (isUniqueViolation(e)) {
              await db.tradeJournal.update({
                where: { userId_brokerRef: { userId, brokerRef } },
                data: updateData,
              });
              updated += 1;
            } else {
              throw e;
            }
          }
        }
      } catch (e) {
        // One row's write failing must not abort the rest, nor the other
        // brokers' imports. Record it against this broker and keep going.
        if (!writeError) writeError = errText(broker, e);
      }
    }
    byBroker.push({ broker, open: positions.length, error: writeError });
  };

  const jobs: Promise<void>[] = [];
  if (bitget) jobs.push(runOne("BITGET", () => bitgetOpenPositions(bitget)));
  if (binance) jobs.push(runOne("BINANCE", () => binanceOpenPositions(binance)));
  if (mexc) jobs.push(runOne("MEXC", () => mexcOpenPositions(mexc)));
  if (okx) jobs.push(runOne("OKX", () => okxOpenPositions(okx)));
  await Promise.all(jobs);

  return { created, updated, byBroker };
}
