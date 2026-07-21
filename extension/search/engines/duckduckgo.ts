/**
 * DuckDuckGo search engine adapter.
 * Uses honest-bot User-Agent, HTML endpoint scraping.
 * Retry logic delegated to RateLimiter.retryOnRateLimit.
 */

import type { SearchProviderCredentials } from "../../settings-context.js";
import { RateLimitError } from "../rate-limiter.js";
import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import { DDG_USER_AGENT, decodeHtmlEntities, postForm, rateLimiter } from "../web-search.js";

// ─── DDG-specific constants ────────────────────────────────────
const DDG_BASE_URL = "https://html.duckduckgo.com/html";

const RATE_LIMIT_INDICATORS = [
  "captcha",
  "rate limit",
  "too many requests",
  "blocked",
  "automated",
  "bots use duckduckgo",
  "challenge",
  "anomaly",
];

// ─── Rate limit detection ──────────────────────────────────────
function isRateLimited(status: number, body: string): boolean {
  if (status === 202 || status === 429 || status >= 500) return true;
  const lowerBody = body.toLowerCase();
  for (const indicator of RATE_LIMIT_INDICATORS) {
    if (lowerBody.includes(indicator)) return true;
  }
  return false;
}

// ─── HTML result parsing ───────────────────────────────────────
function parseDdgHtml(body: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi;

  const links: Array<{ href: string; title: string }> = [];
  const snippets: string[] = [];

  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(body)) !== null) {
    links.push({
      href: linkMatch[1],
      title: decodeHtmlEntities(linkMatch[2].replace(/<[^>]*>/g, "").trim()),
    });
  }

  let snipMatch: RegExpExecArray | null;
  while ((snipMatch = snippetRegex.exec(body)) !== null) {
    snippets.push(decodeHtmlEntities(snipMatch[1].replace(/<[^>]*>/g, "").trim()));
  }

  for (let i = 0; i < links.length && results.length < maxResults; i++) {
    const { href, title } = links[i];

    let cleanUrl = href;
    const uddgMatch = href.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        cleanUrl = decodeURIComponent(uddgMatch[1]);
      } catch {
        cleanUrl = href;
      }
    }

    if (title && cleanUrl && !cleanUrl.includes("duckduckgo.com/l/")) {
      results.push({
        title,
        url: cleanUrl,
        snippet: snippets[i] ?? "",
        engine: "duckduckgo",
      });
    }
  }

  return results;
}

// ─── Search (thin — retry delegated to RateLimiter) ────────────
export async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const { status, body } = await postForm(
    DDG_BASE_URL,
    { q: query },
    {
      timeout: 15_000,
      headers: { "User-Agent": DDG_USER_AGENT },
    },
  );

  if (isRateLimited(status, body)) {
    throw new RateLimitError(status, body);
  }

  return parseDdgHtml(body, maxResults);
}

// ─── Engine adapter interface ──────────────────────────────────
export async function search(
  query: string,
  opts: WebSearchOptions,
  _cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await rateLimiter.waitIfNeeded("duckduckgo");
  const results = await rateLimiter.retryOnRateLimit("duckduckgo", () => searchDuckDuckGo(query, opts.maxResults ?? 5));
  rateLimiter.recordCall("duckduckgo");
  return results;
}
