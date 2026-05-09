/**
 * CryptoPanic news client.
 *
 * Endpoint:
 *   GET https://cryptopanic.com/api/v1/posts/?auth_token=KEY&public=true&kind=news&filter=hot
 *
 * Reads `process.env.CRYPTOPANIC_API_KEY` — throws CryptoPanicError if missing.
 */

const BASE = "https://cryptopanic.com/api/v1/posts/";

export class CryptoPanicError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CryptoPanicError";
    this.status = status;
  }
}

/** Allowed `filter` values per CryptoPanic docs. */
export type CryptoPanicFilter =
  | "rising"
  | "hot"
  | "bullish"
  | "bearish"
  | "important"
  | "saved"
  | "lol";

export type CryptoPanicArticle = {
  externalId: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  currencies?: string[];
};

type RawCurrency = {
  code?: string;
  title?: string;
  slug?: string;
  url?: string;
};

type RawSource = {
  title?: string;
  domain?: string;
  region?: string;
};

type RawPost = {
  id?: number | string;
  title?: string;
  url?: string;
  published_at?: string;
  created_at?: string;
  source?: RawSource;
  domain?: string;
  currencies?: RawCurrency[];
};

type RawResponse = {
  results?: RawPost[];
  // CryptoPanic returns this shape for errors:
  info?: string;
};

function apiKey(): string {
  const key = process.env.CRYPTOPANIC_API_KEY;
  if (!key) {
    throw new CryptoPanicError(
      "Thiếu CRYPTOPANIC_API_KEY trong .env",
    );
  }
  return key;
}

/**
 * Fetch latest posts from CryptoPanic, normalized into a stable shape.
 *
 * @param filter optional CryptoPanic filter (default: "hot")
 * @param limit  hard cap on number of results returned (default: 50)
 */
export async function fetchCryptoPanicNews(
  filter: CryptoPanicFilter = "hot",
  limit = 50,
): Promise<CryptoPanicArticle[]> {
  const url = new URL(BASE);
  url.searchParams.set("auth_token", apiKey());
  url.searchParams.set("public", "true");
  url.searchParams.set("kind", "news");
  url.searchParams.set("filter", filter);

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new CryptoPanicError(
      `CryptoPanic HTTP ${res.status}`,
      res.status,
    );
  }
  const data = (await res.json()) as RawResponse;

  if (!data || !Array.isArray(data.results)) {
    throw new CryptoPanicError(
      data?.info ?? "CryptoPanic: phản hồi không hợp lệ",
    );
  }

  const articles: CryptoPanicArticle[] = [];
  for (const post of data.results.slice(0, limit)) {
    if (!post.id || !post.title || !post.url) continue;
    const publishedAt = new Date(
      post.published_at ?? post.created_at ?? Date.now(),
    );
    if (Number.isNaN(publishedAt.getTime())) continue;

    const source =
      post.source?.title ??
      post.source?.domain ??
      post.domain ??
      "CryptoPanic";

    const currencies = (post.currencies ?? [])
      .map((c) => c.code ?? c.slug)
      .filter((c): c is string => Boolean(c));

    articles.push({
      externalId: String(post.id),
      title: post.title,
      url: post.url,
      source,
      publishedAt,
      currencies: currencies.length > 0 ? currencies : undefined,
    });
  }

  return articles;
}
