/**
 * Public egress IP of THIS server — the address exchanges see when the app
 * calls them, i.e. the IP users must whitelist on their Bitget/Binance API
 * keys. Detected via external echo services (the server can't know its own
 * public IP behind NAT any other way) and cached in-process.
 */

import "server-only";

const TTL_OK_MS = 10 * 60_000;
// A failed lookup is retried sooner, but not on every call — the echo
// services shouldn't be hammered when the box is offline.
const TTL_FAIL_MS = 60_000;

const SOURCES = ["https://api.ipify.org", "https://ifconfig.me/ip"];

let cached: { at: number; ip: string | null } | null = null;

function looksLikeIp(s: string): boolean {
  // v4 dotted quad or anything colon-y (v6). Echo services return the bare
  // address, so a loose shape check is enough to reject HTML error pages.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || /^[0-9a-fA-F:]+$/.test(s);
}

export async function getServerPublicIp(): Promise<string | null> {
  if (cached) {
    const ttl = cached.ip ? TTL_OK_MS : TTL_FAIL_MS;
    if (Date.now() - cached.at < ttl) return cached.ip;
  }

  for (const url of SOURCES) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const ip = (await res.text()).trim();
      if (looksLikeIp(ip)) {
        cached = { at: Date.now(), ip };
        return ip;
      }
    } catch {
      // try next source
    }
  }

  cached = { at: Date.now(), ip: null };
  return null;
}
