const YAHOO_ENDPOINT = "https://query1.finance.yahoo.com/v1/finance/search";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36";

export type RawYahooNewsItem = {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
  summary?: string;
};

export type YahooArticle = {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
};

export type SentimentLabel = "bullish" | "bearish" | "neutral";

const clampLimit = (limit: number) => Math.min(30, Math.max(5, limit));

export async function fetchYahooArticles(query: string, limit: number): Promise<YahooArticle[]> {
  const effectiveLimit = clampLimit(limit);
  const url = new URL(YAHOO_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");
  url.searchParams.set("quotesCount", "0");
  url.searchParams.set("newsCount", String(effectiveLimit));
  url.searchParams.set("listsCount", "0");
  url.searchParams.set("enableFuzzyQuery", "false");

  const response = await fetch(url, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance request failed (${response.status})`);
  }

  const payload = (await response.json()) as { news?: RawYahooNewsItem[] };
  const news = Array.isArray(payload.news) ? payload.news : [];

  return news
    .map(normalizeArticle)
    .filter((article): article is YahooArticle => Boolean(article));
}

function normalizeArticle(item: RawYahooNewsItem): YahooArticle | null {
  if (!item || !item.link || !item.title) {
    return null;
  }

  const publishedAt =
    typeof item.providerPublishTime === "number" && Number.isFinite(item.providerPublishTime)
      ? new Date(item.providerPublishTime * 1000).toISOString()
      : new Date().toISOString();

  return {
    id: item.uuid ?? item.link,
    title: item.title ?? "Untitled",
    source: item.publisher ?? "Yahoo Finance",
    url: item.link,
    summary: item.summary ?? "",
    publishedAt,
  };
}

const BULLISH_KEYWORDS = [
  "beat",
  "beats",
  "surge",
  "rises",
  "rally",
  "record high",
  "strong",
  "upgrade",
  "inflows",
  "gain",
  "optimistic",
];

const BEARISH_KEYWORDS = [
  "miss",
  "misses",
  "drops",
  "plunge",
  "falls",
  "downgrade",
  "layoffs",
  "recession",
  "warning",
  "weak",
  "selloff",
];

export function scoreSentiment(title: string): SentimentLabel {
  if (!title) {
    return "neutral";
  }

  const lower = title.toLowerCase();
  let score = 0;

  for (const keyword of BULLISH_KEYWORDS) {
    if (lower.includes(keyword)) {
      score += 1;
    }
  }

  for (const keyword of BEARISH_KEYWORDS) {
    if (lower.includes(keyword)) {
      score -= 1;
    }
  }

  if (score > 0) return "bullish";
  if (score < 0) return "bearish";
  return "neutral";
}

export function timeAgo(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return "—";
  }
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) {
    return "—";
  }

  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) {
    return "just now";
  }

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
