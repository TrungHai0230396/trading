/**
 * RSS-feed fallback for crypto news.
 *
 * Used when CRYPTOPANIC_API_KEY is not configured. Fetches each feed in
 * parallel, parses with a small regex-based reader, and returns a normalized
 * shape compatible with the rest of the news pipeline.
 *
 * Feed list is curated and intentionally small — these all expose RSS
 * publicly with no auth, and produce stable, well-formed XML.
 */

const FEEDS: { source: string; url: string }[] = [
  // Nguồn tiếng Việt — ưu tiên hiển thị (dẫn nguồn báo VN).
  { source: "Blog Tiền Ảo", url: "https://blogtienao.com/feed" },
  // Google News tiếng Việt, lọc theo crypto (query né nhiễu "giá điện" bằng
  // "tiền mã hóa"/"tiền ảo"); tổng hợp nhiều báo VN (VnExpress, Thanh Niên…).
  {
    source: "Google News VN",
    url: "https://news.google.com/rss/search?q=Bitcoin%20OR%20crypto%20OR%20%22ti%E1%BB%81n%20m%C3%A3%20h%C3%B3a%22%20OR%20%22ti%E1%BB%81n%20%E1%BA%A3o%22%20when:2d&hl=vi&gl=VN&ceid=VN:vi",
  },
  // Báo lớn toàn cầu — tin breaking thường nhanh hơn nguồn VN.
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
];

export type RssArticle = {
  externalId: string; // namespaced: "rss:<source-slug>:<guid>"
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
};

function pickTag(xml: string, tag: string): string | null {
  // Allow attributes on the tag, capture content non-greedy across newlines.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(input: string): string {
  return decodeEntities(input).replace(/<[^>]+>/g, "").trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseItem(itemXml: string, source: string): RssArticle | null {
  const titleRaw = pickTag(itemXml, "title");
  const linkRaw = pickTag(itemXml, "link");
  const guidRaw = pickTag(itemXml, "guid");
  const pubRaw =
    pickTag(itemXml, "pubDate") ??
    pickTag(itemXml, "dc:date") ??
    pickTag(itemXml, "published");

  if (!titleRaw || !linkRaw || !pubRaw) return null;

  const url = stripHtml(linkRaw);
  const title = stripHtml(titleRaw);
  const guid = guidRaw ? stripHtml(guidRaw) : url;
  const publishedAt = new Date(pubRaw.trim());
  if (Number.isNaN(publishedAt.getTime()) || !title || !url) return null;

  return {
    externalId: `rss:${slugify(source)}:${guid}`,
    title: title.slice(0, 512),
    url,
    source,
    publishedAt,
  };
}

async function fetchSingleFeed(
  source: string,
  url: string,
): Promise<RssArticle[]> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 60 },
      headers: {
        // Some publishers block default fetch UA.
        "User-Agent":
          "Mozilla/5.0 (compatible; NhatKyTrade/1.0; +https://github.com/) RSS reader",
        Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
    const out: RssArticle[] = [];
    for (const item of itemMatches) {
      const parsed = parseItem(item, source);
      if (parsed) out.push(parsed);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Fetch all configured RSS feeds in parallel. Always returns an array
 * (errors per feed are swallowed — at least one good feed should still
 * yield results).
 *
 * @param limit hard cap on the merged result (default 50, matches CryptoPanic)
 */
export async function fetchRssNews(limit = 50): Promise<RssArticle[]> {
  const perFeed = await Promise.all(
    FEEDS.map(({ source, url }) => fetchSingleFeed(source, url)),
  );
  const merged = perFeed.flat();
  merged.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return merged.slice(0, limit);
}
