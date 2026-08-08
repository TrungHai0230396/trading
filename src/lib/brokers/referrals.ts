/**
 * Exchange links, centralized.
 *
 *  - `register` carries the OWNER's referral/affiliate link so new signups
 *    from the app earn commission. Referral URLs are PUBLIC (safe to commit).
 *  - `apiKey` is the API-management page an existing user opens to create a
 *    read-only key.
 *
 * ▶ TO EARN REFERRALS: replace each `register` URL below with your own
 *   affiliate link from that exchange's referral program. The example format
 *   is shown in the comment. If left as the plain register page, the app
 *   still works — it just won't attribute the signup to you.
 */

export type Exchange = "BITGET" | "BINANCE" | "MEXC" | "OKX";

export type ExchangeLinks = {
  /** Owner referral link — where "Mở tài khoản" points. */
  register: string;
  /** API-management page — where "tạo API key" points. */
  apiKey: string;
};

export const EXCHANGE_LINKS: Record<Exchange, ExchangeLinks> = {
  BITGET: {
    // Owner referral link (Bitget affiliate).
    register: "https://share.bitget.com/u/EMK3C9B6",
    apiKey: "https://www.bitget.com/account/newapi",
  },
  BINANCE: {
    // Owner referral link (Binance ref=126238765).
    register: "https://www.binance.com/register?ref=126238765",
    apiKey: "https://www.binance.com/en/my/settings/api-management",
  },
  MEXC: {
    // Owner referral link (MEXC promote).
    register: "https://promote.mexc.com/r/khTQ4da01Y",
    apiKey: "https://www.mexc.com/user/openapi",
  },
  OKX: {
    // Owner referral link (OKX join/49706276).
    register: "https://okx.com/join/49706276",
    apiKey: "https://www.okx.com/account/my-api",
  },
};

/**
 * Forex brokers — kept separate from EXCHANGE_LINKS because they are a
 * different kind of thing: the app has no read-only API integration for them,
 * so there is no `apiKey` page to point at. Forex trades reach the journal via
 * the MT4/MT5 HTML import instead, which is where this link is surfaced.
 */
export const FOREX_BROKER_LINKS = {
  EXNESS: {
    name: "Exness",
    // Owner referral link (Exness One Link).
    register: "https://one.exnessonelink.com/a/uuokuth9?source=app",
  },
} as const;
