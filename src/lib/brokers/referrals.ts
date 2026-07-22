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

export type Exchange = "BITGET" | "BINANCE" | "MEXC";

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
};
