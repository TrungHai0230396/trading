/**
 * Etherscan / BscScan v1 explorer client.
 *
 * Both explorers expose the same `module=...&action=...` surface; we just
 * swap host + API key based on the selected chain.
 *
 * Keys are read from env:
 *   - ETH → ETHERSCAN_API_KEY
 *   - BSC → BSCSCAN_API_KEY
 *
 * All responses are returned roughly as-is (we keep raw JSON) so the
 * downstream AI prompt can see the original explorer payload.
 */

export type ExplorerChain = "ETH" | "BSC";

const HOSTS: Record<ExplorerChain, string> = {
  ETH: "https://api.etherscan.io/api",
  BSC: "https://api.bscscan.com/api",
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
  const v = process.env[ENV_KEYS[chain]];
  if (!v) throw new MissingKeyError(chain);
  return v;
}

type ExplorerParams = Record<string, string | number | undefined>;

async function explorerFetch<T = unknown>(
  chain: ExplorerChain,
  params: ExplorerParams,
): Promise<T> {
  const url = new URL(HOSTS[chain]);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set("apikey", apiKey(chain));

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (res.status === 429) throw new RateLimitError(chain);
  if (!res.ok) {
    throw new ExplorerError(`${chain} explorer HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
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

export type WalletSnapshot = {
  address: string;
  chain: ExplorerChain;
  balanceWei: string | null;
  recentTxs: NormalTx[];
  recentTokenTransfers: Erc20Transfer[];
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

  return {
    address,
    chain,
    balanceWei: typeof balanceRes.result === "string" ? balanceRes.result : null,
    recentTxs: Array.isArray(txsRes.result) ? txsRes.result : [],
    recentTokenTransfers: Array.isArray(tokensRes.result)
      ? tokensRes.result
      : [],
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
    recentTransfers: Array.isArray(transfersRes.result)
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
