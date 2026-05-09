/**
 * Resolve "1 unit of `from` is how many units of `to`?".
 * Used to convert pip value & risk amount across the user's account currency.
 *
 * Strategy:
 *   1. If from == to → 1.
 *   2. exchangerate.host (no API key, generous free tier).
 *   3. Twelve Data (if a key is configured) — used as a fallback signal.
 *
 * The result is cached for 60s by Next's fetch cache.
 */

import { getTwelveDataPrice } from "@/lib/quotes/twelvedata";

const HOST_BASE = "https://api.exchangerate.host";

export class FxRateError extends Error {}

async function fromExchangerateHost(
  from: string,
  to: string,
): Promise<number | null> {
  try {
    const url = new URL("/convert", HOST_BASE);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("amount", "1");
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: number; success?: boolean };
    if (typeof data.result === "number" && data.result > 0) return data.result;
    return null;
  } catch {
    return null;
  }
}

async function fromTwelveData(
  from: string,
  to: string,
): Promise<number | null> {
  if (!process.env.TWELVE_DATA_API_KEY) return null;
  try {
    return await getTwelveDataPrice(`${from}/${to}`);
  } catch {
    return null;
  }
}

/** Returns rate or throws if no provider can resolve it. */
export async function getFxRate(from: string, to: string): Promise<number> {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return 1;

  const host = await fromExchangerateHost(f, t);
  if (host != null) return host;

  const td = await fromTwelveData(f, t);
  if (td != null) return td;

  throw new FxRateError(
    `Could not fetch FX rate ${f}/${t} from any provider.`,
  );
}
