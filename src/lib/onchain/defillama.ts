/**
 * DefiLlama coins price API — no API key required.
 *
 * Endpoint: https://coins.llama.fi/prices/current/{chainKey}:{address}
 */

import type { ExplorerChain } from "@/lib/onchain/explorer";

const BASE = "https://coins.llama.fi/prices/current";

const CHAIN_KEYS: Record<ExplorerChain, string> = {
  ETH: "ethereum",
  BSC: "bsc",
};

export type LlamaPrice = {
  price: number;
  symbol?: string;
  decimals?: number;
  timestamp?: number;
  confidence?: number;
};

type LlamaResponse = {
  coins?: Record<
    string,
    {
      price?: number;
      symbol?: string;
      decimals?: number;
      timestamp?: number;
      confidence?: number;
    }
  >;
};

/**
 * Fetch the latest USD price for a token contract.
 * Returns `null` when the coin is unknown / has no oracle.
 */
export async function getTokenPrice(
  chain: ExplorerChain,
  address: string,
): Promise<LlamaPrice | null> {
  const chainKey = CHAIN_KEYS[chain];
  const key = `${chainKey}:${address.toLowerCase()}`;
  const url = `${BASE}/${encodeURIComponent(key)}`;

  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate: 60 } });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: LlamaResponse;
  try {
    data = (await res.json()) as LlamaResponse;
  } catch {
    return null;
  }

  const coin = data.coins?.[key];
  if (!coin || typeof coin.price !== "number") return null;

  return {
    price: coin.price,
    symbol: coin.symbol,
    decimals: coin.decimals,
    timestamp: coin.timestamp,
    confidence: coin.confidence,
  };
}
