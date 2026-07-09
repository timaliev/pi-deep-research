/**
 * DuckDuckGo search engine adapter.
 * Uses honest-bot User-Agent, HTML endpoint scraping, and exponential backoff on rate limits.
 */

import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../settings-context.js";
import {
  DDG_USER_AGENT,
  postForm,
  sleep,
  decodeHtmlEntities,
  engineLastCall,
  waitIfNeeded,
} from "../web-search.js";

// ─── DDG-specific constants ────────────────────────────────────
const DDG_BASE_URL = "https://html.duckduckgo.com/html";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const BACKOFF_MULTIPLIER = 2.0;
const JITTER_MS = 500;

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

// ─── Exponential backoff with jitter ───────────────────────────
function calcDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  let delay = baseDelay * Math.pow(BACKOFF_MULTIPLIER, attempt);
  if (delay > maxDelay) delay = maxDelay;
  delay += Math.random() * JITTER_MS;
  return Math.floor(delay);
}

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

  const linkRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi;

  const links: Array<{ href: string; title: string }> = [];
  const snippets: string[] = [];

  let linkMatch;
  while ((linkMatch = linkRegex.exec(body)) !== null) {
    links.push({
      href: linkMatch[1],
      title: decodeHtmlEntities(
        linkMatch[2].replace(/<[^>]*>/g, "").trim(),
      ),
    });
  }

  let snipMatch;
  while ((snipMatch = snippetRegex.exec(body)) !== null) {
    snippets.push(
      decodeHtmlEntities(snipMatch[1].replace(/<[^>]*>/g, "").trim()),
    );
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

// ─── Search with retry + exponential backoff ───────────────────
export async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  baseDelay: number = DEFAULT_BASE_DELAY_MS,
  maxDelay: number = DEFAULT_MAX_DELAY_MS,
): Promise<WebSearchResult[]> {
  // Stagger concurrent DDG requests: random pre-delay BEFORE touching engineLastCall
  const preStaggerMs = Math.random() * 2000;
  engineLastCall["duckduckgo"] = Date.now() + preStaggerMs;
  await sleep(preStaggerMs);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = calcDelay(attempt - 1, baseDelay, maxDelay);
      await sleep(delay);
    }

    try {
      const { status, body } = await postForm(
        DDG_BASE_URL,
        { q: query },
        {
          timeout: 15_000,
          headers: { "User-Agent": DDG_USER_AGENT },
        },
      );

      if (isRateLimited(status, body)) {
        if (attempt < maxRetries) continue;
        throw new Error(
          `DuckDuckGo rate-limited after ${maxRetries + 1} attempts`,
        );
      }

      return parseDdgHtml(body, maxResults);
    } catch (err: any) {
      if (attempt < maxRetries) continue;
      throw err;
    }
  }

  return [];
}

// ─── Engine adapter interface ──────────────────────────────────
export async function search(
  query: string,
  opts: WebSearchOptions,
  _cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("duckduckgo");
  return searchDuckDuckGo(query, opts.maxResults ?? 5);
}
