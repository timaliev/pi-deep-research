/**
 * SearXNG public instance search adapter.
 * Queries public SearXNG instances with automatic failover.
 */

import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../settings-context.js";
import { DDG_USER_AGENT, fetchUrl, rateLimiter } from "../web-search.js";

const SEARXNG_INSTANCES = ["https://searx.be", "https://search.sapti.me"];

export async function searchSearXNG(
  query: string,
  maxResults: number,
  instanceIndex: number = 0,
): Promise<WebSearchResult[]> {
  if (instanceIndex >= SEARXNG_INSTANCES.length) return [];

  const base = SEARXNG_INSTANCES[instanceIndex];
  try {
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
    const { status, body } = await fetchUrl(url, {
      timeout: 12_000,
      headers: {
        Accept: "application/json",
        "User-Agent": DDG_USER_AGENT,
      },
    });

    if (status !== 200) {
      return searchSearXNG(query, maxResults, instanceIndex + 1);
    }

    const data = JSON.parse(body);
    return (data.results ?? []).slice(0, maxResults).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? r.snippet ?? "",
      engine: "searxng",
    }));
  } catch {
    return searchSearXNG(query, maxResults, instanceIndex + 1);
  }
}

export async function search(
  query: string,
  opts: WebSearchOptions,
  _cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await rateLimiter.waitIfNeeded("searxng");
  const results = await searchSearXNG(query, opts.maxResults ?? 5);
  rateLimiter.recordCall("searxng");
  return results;
}
