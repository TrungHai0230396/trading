/**
 * MetaApi cloud bridge — Exness MT4/MT5 access (Phase 1 read-only).
 *
 * Lifecycle:
 *   1. User pastes their MetaApi token (from metaapi.cloud) + MT login
 *      credentials. We send the MT creds to MetaApi which provisions
 *      a cloud MT terminal, then returns an accountId.
 *   2. We persist `{ token, accountId }` only. MT login/password is
 *      handed to MetaApi and never stored on our side.
 *   3. Later balance/positions calls use accountId + token.
 *
 * Notes:
 *   - `metaapi.cloud-sdk` is heavy; tagged `server-only`.
 *   - We use the RPC connection (request/response) not streaming —
 *     simpler to fit Next.js route handlers, latency ~200-500ms.
 *   - One MetaApi instance per token cached in-process (the SDK
 *     maintains a long-lived ws under the hood; recreating on every
 *     call would be wasteful).
 */

import "server-only";

// The SDK's main type is exported as default. We avoid importing the
// type directly here — too many internal types leak — and instead use
// a structural alias.
type MetaApiClient = {
  metatraderAccountApi: {
    getAccountsWithInfiniteScrollPagination: (opts: {
      limit?: number;
    }) => Promise<unknown[]>;
    createAccount: (opts: Record<string, unknown>) => Promise<MtAccount>;
    getAccount: (id: string) => Promise<MtAccount>;
  };
};

type MtAccount = {
  id: string;
  state: string;
  deploy: () => Promise<void>;
  waitConnected: () => Promise<void>;
  remove: () => Promise<void>;
  getRPCConnection: () => {
    connect: () => Promise<void>;
    waitSynchronized: (opts?: { timeoutInSeconds?: number }) => Promise<void>;
    getAccountInformation: () => Promise<{
      currency: string;
      balance: number;
      equity: number;
      margin: number;
      freeMargin: number;
      marginLevel?: number;
    }>;
    getPositions: () => Promise<
      Array<{
        id: string;
        symbol: string;
        type: string;
        volume: number;
        openPrice: number;
        currentPrice?: number;
        swap?: number;
        profit?: number;
        stopLoss?: number;
        takeProfit?: number;
      }>
    >;
  };
};

export type MetaApiCreds = {
  token: string;
  accountId: string;
};

export type MtAccountSpec = {
  login: string;
  password: string;
  server: string; // e.g. "Exness-Real4"
  platform: "mt4" | "mt5";
  name?: string;
};

export type MetaBalance = {
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number | null;
};

export type MetaPosition = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  volume: number;
  openPrice: number;
  currentPrice: number;
  swap: number;
  profit: number;
  stopLoss: number | null;
  takeProfit: number | null;
};

const clients = new Map<string, MetaApiClient>();

async function clientFor(token: string): Promise<MetaApiClient> {
  let c = clients.get(token);
  if (!c) {
    // Dynamic import keeps the heavy SDK out of the cold-start path
    // when the user has no MetaApi creds saved.
    const mod = await import("metaapi.cloud-sdk/esm-node");
    // The SDK's `MetaApi` constructor exports rich nominal types we
    // don't want leaking through this module. We only use a tiny
    // structural subset (MetaApiClient), so we cast via `unknown` to
    // sidestep the constructor-shape mismatch and keep our surface
    // typed locally.
    const Ctor = (mod.default ?? mod) as unknown as new (
      token: string,
      opts?: Record<string, unknown>,
    ) => MetaApiClient;
    c = new Ctor(token, { domain: "agiliumtrade.agiliumtrade.ai" });
    clients.set(token, c);
  }
  return c;
}

/**
 * Validate the MetaApi token. Cheapest call is listing accounts with
 * limit=1 — succeeds if the token can reach the provisioning API.
 */
export async function testToken(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const c = await clientFor(token);
    await c.metatraderAccountApi.getAccountsWithInfiniteScrollPagination({
      limit: 1,
    });
    return { ok: true };
  } catch (err) {
    const e = err as { status?: number; response?: { status?: number } };
    const status = e?.status ?? e?.response?.status;
    if (status === 401) {
      return {
        ok: false,
        error: "Token MetaApi không hợp lệ hoặc đã hết hạn.",
      };
    }
    if (status === 403) {
      return {
        ok: false,
        error: "Token không có quyền truy cập tài khoản này.",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Không kết nối được MetaApi: ${msg}`,
    };
  }
}

/**
 * Provision a new MT account in MetaApi.
 *
 * SECURITY: the MT login/password are passed straight to MetaApi here
 * and are NEVER stored on our side. Callers must not log `spec`.
 *
 * Returns the cloud accountId we persist for later calls.
 */
export async function addAccount(
  token: string,
  spec: MtAccountSpec,
): Promise<string> {
  const c = await clientFor(token);
  const account = await c.metatraderAccountApi.createAccount({
    name: spec.name ?? `${spec.platform.toUpperCase()} ${spec.login}`,
    type: "cloud-g2",
    login: spec.login,
    password: spec.password,
    server: spec.server,
    platform: spec.platform,
    magic: 0,
    application: "MetaApi",
    keywords: ["tranding-phase1"],
  });
  await account.deploy();
  await account.waitConnected();
  return account.id;
}

async function readyAccount(token: string, accountId: string) {
  const c = await clientFor(token);
  const acc = await c.metatraderAccountApi.getAccount(accountId);
  if (acc.state !== "DEPLOYED") await acc.deploy();
  const conn = acc.getRPCConnection();
  await conn.connect();
  await conn.waitSynchronized({ timeoutInSeconds: 30 });
  return { acc, conn };
}

export async function getBalance(creds: MetaApiCreds): Promise<MetaBalance> {
  const { conn } = await readyAccount(creds.token, creds.accountId);
  const info = await conn.getAccountInformation();
  return {
    currency: info.currency,
    balance: info.balance,
    equity: info.equity,
    margin: info.margin,
    freeMargin: info.freeMargin,
    marginLevel: info.marginLevel ?? null,
  };
}

export async function getPositions(
  creds: MetaApiCreds,
): Promise<MetaPosition[]> {
  const { conn } = await readyAccount(creds.token, creds.accountId);
  const positions = await conn.getPositions();
  return positions.map((p) => ({
    id: p.id,
    symbol: p.symbol,
    // MT5 position type: POSITION_TYPE_BUY=0, POSITION_TYPE_SELL=1 (string in SDK).
    side: p.type === "POSITION_TYPE_BUY" || p.type === "0" ? "buy" : "sell",
    volume: p.volume,
    openPrice: p.openPrice,
    currentPrice: p.currentPrice ?? p.openPrice,
    swap: p.swap ?? 0,
    profit: p.profit ?? 0,
    stopLoss: p.stopLoss ?? null,
    takeProfit: p.takeProfit ?? null,
  }));
}

export async function removeAccount(
  token: string,
  accountId: string,
): Promise<void> {
  const c = await clientFor(token);
  const acc = await c.metatraderAccountApi.getAccount(accountId);
  await acc.remove();
}
