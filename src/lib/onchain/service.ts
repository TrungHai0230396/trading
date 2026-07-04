/**
 * On-chain report service — orchestrates explorer + DefiLlama + Gemini and
 * persists the resulting report. Owner-scoped.
 */

import { db } from "@/lib/db";
import {
  fetchTokenSnapshot,
  fetchTransactionSnapshot,
  fetchWalletSnapshot,
  type ExplorerChain,
  type TokenSnapshot,
  type WalletSnapshot,
  type TransactionSnapshot,
} from "@/lib/onchain/explorer";
import { getTokenPrice, type LlamaPrice } from "@/lib/onchain/defillama";
import { analyzeOnchain, type OnchainTargetType } from "@/lib/ai/onchain";
import type { OnchainReport, Prisma } from "@/generated/prisma";

export type RunOnchainInput = {
  userId: string;
  chain: ExplorerChain;
  targetType: OnchainTargetType;
  target: string;
};

export type RunOnchainSnapshot =
  | ({ kind: "WALLET" } & WalletSnapshot)
  | ({ kind: "TOKEN"; price: LlamaPrice | null } & TokenSnapshot)
  | ({ kind: "TRANSACTION" } & TransactionSnapshot);

const TRANSFER_LIMIT = 50;

function truncateForStorage(snapshot: RunOnchainSnapshot): unknown {
  if (snapshot.kind === "WALLET") {
    return {
      kind: "WALLET",
      address: snapshot.address,
      chain: snapshot.chain,
      balanceWei: snapshot.balanceWei,
      recentTxs: snapshot.recentTxs.slice(0, 25),
      recentTokenTransfers: snapshot.recentTokenTransfers.slice(0, TRANSFER_LIMIT),
      holdings: snapshot.holdings,
    };
  }
  if (snapshot.kind === "TOKEN") {
    return {
      kind: "TOKEN",
      address: snapshot.address,
      chain: snapshot.chain,
      info: snapshot.info,
      price: snapshot.price,
      recentTransfers: snapshot.recentTransfers.slice(0, TRANSFER_LIMIT),
    };
  }
  return {
    kind: "TRANSACTION",
    hash: snapshot.hash,
    chain: snapshot.chain,
    tx: snapshot.tx,
    receipt: snapshot.receipt,
  };
}

export async function runOnchainReport(
  input: RunOnchainInput,
): Promise<OnchainReport> {
  const { userId, chain, targetType, target } = input;

  // 1. Fetch raw explorer data + (TOKEN) price
  let snapshot: RunOnchainSnapshot;
  let price: LlamaPrice | null = null;

  if (targetType === "WALLET") {
    const wallet = await fetchWalletSnapshot(chain, target);
    snapshot = { kind: "WALLET", ...wallet };
  } else if (targetType === "TOKEN") {
    const [token, p] = await Promise.all([
      fetchTokenSnapshot(chain, target),
      getTokenPrice(chain, target),
    ]);
    price = p;
    snapshot = { kind: "TOKEN", price, ...token };
  } else {
    const tx = await fetchTransactionSnapshot(chain, target);
    snapshot = { kind: "TRANSACTION", ...tx };
  }

  const stored = truncateForStorage(snapshot);

  // 2. AI analysis
  const analysis = await analyzeOnchain({
    chain,
    targetType,
    target,
    raw: stored,
    price,
  });

  // 3. Persist
  const report = await db.onchainReport.create({
    data: {
      userId,
      chain,
      targetType,
      target,
      rawData: stored as Prisma.InputJsonValue,
      summary: analysis.summary,
      riskLevel: analysis.riskLevel,
      insights: analysis.insights as unknown as Prisma.InputJsonValue,
      aiModel: analysis.aiModel,
    },
  });

  return report;
}

export async function listOnchainReports(opts: {
  userId: string;
  cursor?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const items = await db.onchainReport.findMany({
    where: { userId: opts.userId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(opts.cursor
      ? { cursor: { id: opts.cursor }, skip: 1 }
      : {}),
  });
  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  return {
    items: trimmed,
    nextCursor: hasMore ? trimmed[trimmed.length - 1]?.id ?? null : null,
  };
}

export async function getOnchainReport(opts: {
  userId: string;
  id: string;
}): Promise<OnchainReport | null> {
  return db.onchainReport.findFirst({
    where: { id: opts.id, userId: opts.userId },
  });
}
