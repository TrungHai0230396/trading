/**
 * Etherscan V2 multi-chain client.
 *
 * As of mid-2025 Etherscan deprecated the per-chain V1 hosts in favour of
 * a single V2 endpoint that takes a `chainid` query param. The V1 hosts
 * (api.etherscan.io/api, api.bscscan.com/api) now return error strings
 * like "You are using a deprecated V1 endpoint…" inside the `result`
 * field — which silently poisoned our wallet snapshots until we noticed
 * empty txs everywhere.
 *
 * V2 quirks:
 * - Single host: https://api.etherscan.io/v2/api
 * - `chainid` param: 1 = ETH, 56 = BSC
 * - One Etherscan key works for all chains. We still let users set
 *   BSCSCAN_API_KEY as a fallback for back-compat, but prefer the
 *   Etherscan key.
 */

export type ExplorerChain = "ETH" | "BSC";

const V2_HOST = "https://api.etherscan.io/v2/api";

const CHAIN_IDS: Record<ExplorerChain, number> = {
  ETH: 1,
  BSC: 56,
};

const ENV_KEYS: Record<ExplorerChain, string> = {
  ETH: "ETHERSCAN_API_KEY",
  BSC: "BSCSCAN_API_KEY",
};

export class ExplorerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ExplorerError";
  }
}

export class RateLimitError extends ExplorerError {
  constructor(chain: ExplorerChain) {
    super(`${chain} explorer rate-limited (HTTP 429).`, 429, "RATE_LIMIT");
    this.name = "RateLimitError";
  }
}

export class MissingKeyError extends ExplorerError {
  constructor(chain: ExplorerChain) {
    super(
      `Thiếu ${ENV_KEYS[chain]} trong .env. Hãy thêm key Etherscan/BscScan trước khi chạy phân tích on-chain.`,
      undefined,
      "MISSING_KEY",
    );
    this.name = "MissingKeyError";
  }
}

function apiKey(chain: ExplorerChain): string {
  // V2 prefers a single Etherscan key for all chains. Fall back to the
  // chain-specific env var if the unified key isn't set.
  const unified = process.env.ETHERSCAN_API_KEY;
  if (unified) return unified;
  const v = process.env[ENV_KEYS[chain]];
  if (!v) throw new MissingKeyError(chain);
  return v;
}

type ExplorerParams = Record<string, string | number | undefined>;

async function explorerFetch<T = unknown>(
  chain: ExplorerChain,
  params: ExplorerParams,
): Promise<T> {
  const url = new URL(V2_HOST);
  url.searchParams.set("chainid", String(CHAIN_IDS[chain]));
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set("apikey", apiKey(chain));

  // No HTTP cache: stale-while-revalidate would serve old wallet data on
  // the first request after an idle period.
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 429) throw new RateLimitError(chain);
  if (!res.ok) {
    throw new ExplorerError(`${chain} explorer HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/**
 * Etherscan returns `status: "1"` for success, `status: "0"` for errors
 * (with the error text inside `result`). We must check status before
 * treating `result` as actual data, otherwise an error string leaks into
 * downstream snapshots — that's how "You are using a deprecated V1
 * endpoint…" ended up stored as a wallet balance.
 */
function isOk<T>(env: ExplorerEnvelope<T>): boolean {
  // status may be omitted on JSON-RPC proxy responses; fall back to result presence.
  if (env.status === undefined) return env.result !== undefined;
  return env.status === "1";
}

// ───────────────────────────────────────────────────────────── shared types
type ExplorerEnvelope<T> = {
  status?: string;
  message?: string;
  result?: T;
};

export type Erc20Transfer = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  contractAddress: string;
};

export type NormalTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasUsed: string;
  isError: string;
  txreceipt_status?: string;
  input?: string;
  contractAddress?: string;
};

/**
 * Per-token aggregate computed from the wallet's recent transfers, plus
 * the current on-chain balance fetched via Etherscan V2.
 *
 * - `balance` is the wallet's CURRENT token balance (raw integer string,
 *   not divided by decimals). `null` if the balance call failed.
 * - `incoming` / `outgoing` are counts and integer-string sums (also raw,
 *   not divided by decimals) computed from `recentTokenTransfers` — i.e.
 *   they only cover the last N transfers we fetched, not lifetime.
 */
export type TokenHolding = {
  contract: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  balance: string | null;
  incoming: { count: number; total: string };
  outgoing: { count: number; total: string };
  /** First and last block seen for this token in the recent window. */
  firstBlock: string | null;
  lastBlock: string | null;
};

export type WalletSnapshot = {
  address: string;
  chain: ExplorerChain;
  balanceWei: string | null;
  recentTxs: NormalTx[];
  recentTokenTransfers: Erc20Transfer[];
  holdings: TokenHolding[];
};

export type TokenSnapshot = {
  address: string;
  chain: ExplorerChain;
  info: unknown | null;
  recentTransfers: Erc20Transfer[];
};

export type TransactionSnapshot = {
  hash: string;
  chain: ExplorerChain;
  tx: unknown | null;
  receipt: unknown | null;
};

// ───────────────────────────────────────────────────────────── WALLET

/**
 * V2 tokenbalance. Returns the wallet's current balance of a specific
 * ERC-20 (as a raw integer string in token's smallest unit).
 */
async function fetchTokenBalance(
  chain: ExplorerChain,
  address: string,
  contract: string,
): Promise<string | null> {
  try {
    const res = await explorerFetch<ExplorerEnvelope<string>>(chain, {
      module: "account",
      action: "tokenbalance",
      contractaddress: contract,
      address,
      tag: "latest",
    });
    if (!isOk(res)) {
      console.warn(
        `[onchain] tokenbalance soft-fail ${contract}: status=${res.status} message=${res.message} result=${String(res.result).slice(0, 80)}`,
      );
      return null;
    }
    // Etherscan returns balance as a string; accept numeric too just in case.
    if (typeof res.result === "string") return res.result;
    if (typeof res.result === "number") return String(res.result);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[onchain] tokenbalance error ${contract}: ${msg}`);
    return null;
  }
}

/**
 * Sum BigInt-as-string values without converting through Number (which
 * would lose precision for tokens with 18 decimals).
 */
function sumStrInts(a: string, b: string): string {
  try {
    return (BigInt(a) + BigInt(b)).toString();
  } catch {
    return a;
  }
}

/**
 * From the recent token transfers, build a per-token aggregate, then
 * fetch the current on-chain balance for each (capped to TOP_TOKEN_CAP
 * by transfer activity to avoid hammering the explorer for tokens the
 * wallet probably doesn't care about).
 */
// Etherscan free tier allows 5 req/sec. We've already burned 3 (balance +
// txlist + tokentx) on the wallet snapshot, so balance fetches must be
// gentle. Serialize with a ~220ms gap → ≤5 req/sec, safe even alongside
// other concurrent reports.
const TOP_TOKEN_CAP = 10;
const BALANCE_DELAY_MS = 220;

async function buildHoldings(
  chain: ExplorerChain,
  address: string,
  transfers: Erc20Transfer[],
): Promise<TokenHolding[]> {
  const lower = address.toLowerCase();
  type Agg = Omit<TokenHolding, "balance">;
  const byContract = new Map<string, Agg>();

  for (const t of transfers) {
    if (!t.contractAddress) continue;
    const key = t.contractAddress.toLowerCase();
    let h = byContract.get(key);
    if (!h) {
      h = {
        contract: t.contractAddress,
        symbol: t.tokenSymbol ?? null,
        name: t.tokenName ?? null,
        decimals: t.tokenDecimal ? Number(t.tokenDecimal) : null,
        incoming: { count: 0, total: "0" },
        outgoing: { count: 0, total: "0" },
        firstBlock: t.blockNumber,
        lastBlock: t.blockNumber,
      };
      byContract.set(key, h);
    }
    // Newer-first sort means the first row we see is the "last" block;
    // we update firstBlock as we encounter older ones.
    if (t.blockNumber && Number(t.blockNumber) < Number(h.firstBlock ?? Infinity)) {
      h.firstBlock = t.blockNumber;
    }
    if (t.from?.toLowerCase() === lower) {
      h.outgoing.count++;
      h.outgoing.total = sumStrInts(h.outgoing.total, t.value || "0");
    } else if (t.to?.toLowerCase() === lower) {
      h.incoming.count++;
      h.incoming.total = sumStrInts(h.incoming.total, t.value || "0");
    }
  }

  // Pick most-active tokens to query balance for.
  const ranked = [...byContract.values()].sort(
    (a, b) =>
      b.incoming.count + b.outgoing.count - (a.incoming.count + a.outgoing.count),
  );
  const top = ranked.slice(0, TOP_TOKEN_CAP);

  // Serialized fetch with a small inter-call delay. The wallet snapshot
  // above already issued 3 concurrent calls; give the 1-sec rolling
  // rate-limit window a full second to clear before starting the
  // balance loop, otherwise the FIRST balance call lands inside the
  // burst and frequently gets dropped (Etherscan returns 200 OK with
  // a non-result message, which is harder to detect than a 429).
  await new Promise((r) => setTimeout(r, 1100));
  const balances = new Map<string, string | null>();
  for (const h of top) {
    const bal = await fetchTokenBalance(chain, address, h.contract);
    balances.set(h.contract.toLowerCase(), bal);
    await new Promise((r) => setTimeout(r, BALANCE_DELAY_MS));
  }

  // Keep the ranking; tokens without a fetched balance fall through with
  // balance=null so the UI can still show their activity.
  return ranked.map((h) => ({
    ...h,
    balance: balances.get(h.contract.toLowerCase()) ?? null,
  }));
}

export async function fetchWalletSnapshot(
  chain: ExplorerChain,
  address: string,
): Promise<WalletSnapshot> {
  const [balanceRes, txsRes, tokensRes] = await Promise.all([
    explorerFetch<ExplorerEnvelope<string>>(chain, {
      module: "account",
      action: "balance",
      address,
      tag: "latest",
    }),
    explorerFetch<ExplorerEnvelope<NormalTx[]>>(chain, {
      module: "account",
      action: "txlist",
      address,
      page: 1,
      offset: 25,
      sort: "desc",
    }),
    explorerFetch<ExplorerEnvelope<Erc20Transfer[]>>(chain, {
      module: "account",
      action: "tokentx",
      address,
      page: 1,
      offset: 50,
      sort: "desc",
    }),
  ]);

  const recentTokenTransfers =
    isOk(tokensRes) && Array.isArray(tokensRes.result) ? tokensRes.result : [];

  const holdings = await buildHoldings(chain, address, recentTokenTransfers);

  return {
    address,
    chain,
    balanceWei:
      isOk(balanceRes) && typeof balanceRes.result === "string"
        ? balanceRes.result
        : null,
    recentTxs:
      isOk(txsRes) && Array.isArray(txsRes.result) ? txsRes.result : [],
    recentTokenTransfers,
    holdings,
  };
}

// ───────────────────────────────────────────────────────────── TOKEN

export async function fetchTokenSnapshot(
  chain: ExplorerChain,
  address: string,
): Promise<TokenSnapshot> {
  // tokeninfo may be PRO-tier on Etherscan; treat 401/403/PRO message as null.
  let info: unknown | null = null;
  try {
    const res = await explorerFetch<ExplorerEnvelope<unknown>>(chain, {
      module: "token",
      action: "tokeninfo",
      contractaddress: address,
    });
    if (res.status === "1" && res.result) {
      info = Array.isArray(res.result) ? res.result[0] ?? null : res.result;
    }
  } catch (err) {
    if (err instanceof ExplorerError && (err.status === 401 || err.status === 403)) {
      info = null;
    } else if (err instanceof RateLimitError) {
      throw err;
    } else {
      // swallow other tokeninfo failures — it's a nice-to-have
      info = null;
    }
  }

  const transfersRes = await explorerFetch<ExplorerEnvelope<Erc20Transfer[]>>(
    chain,
    {
      module: "account",
      action: "tokentx",
      contractaddress: address,
      page: 1,
      offset: 50,
      sort: "desc",
    },
  );

  return {
    address,
    chain,
    info,
    recentTransfers:
      isOk(transfersRes) && Array.isArray(transfersRes.result)
        ? transfersRes.result
        : [],
  };
}

// ───────────────────────────────────────────────────────────── TRANSACTION

type ProxyTxResponse = {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
};

export async function fetchTransactionSnapshot(
  chain: ExplorerChain,
  txhash: string,
): Promise<TransactionSnapshot> {
  const [txRes, receiptRes] = await Promise.all([
    explorerFetch<ProxyTxResponse>(chain, {
      module: "proxy",
      action: "eth_getTransactionByHash",
      txhash,
    }),
    // gettxinfo is the closest "receipt + logs" rollup.
    explorerFetch<ExplorerEnvelope<unknown>>(chain, {
      module: "transaction",
      action: "gettxinfo",
      txhash,
    }).catch((err) => {
      // If the action is not supported on the chain, fall back to the proxy
      // receipt instead of failing the whole snapshot.
      if (err instanceof RateLimitError) throw err;
      return { result: null } as ExplorerEnvelope<unknown>;
    }),
  ]);

  let receipt = receiptRes.result ?? null;
  if (!receipt) {
    try {
      const proxyReceipt = await explorerFetch<ProxyTxResponse>(chain, {
        module: "proxy",
        action: "eth_getTransactionReceipt",
        txhash,
      });
      receipt = proxyReceipt.result ?? null;
    } catch {
      receipt = null;
    }
  }

  return {
    hash: txhash,
    chain,
    tx: txRes.result ?? null,
    receipt,
  };
}
