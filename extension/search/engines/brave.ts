/**
 * Brave Search API adapter.
 * Uses Brave's Web Search API with subscription-token auth.
 */

import type { SearchProviderCredentials } from "../../settings-context.js";
import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import { DDG_USER_AGENT, fetchUrl, rateLimiter } from "../web-search.js";

// ─── Credential resolution ────────────────────────────────────

export function resolveBraveApiKey(cred?: SearchProviderCredentials): string | undefined {
  if (process.env.BRAVE_API_KEY) return process.env.BRAVE_API_KEY;
  return cred?.get("brave", "apiKey");
}

// ─── URL builder ───────────────────────────────────────────────

interface BraveSearchOptions {
  freshness?: string;
  country?: string;
  searchLang?: string;
  extraSnippets?: boolean;
  offset?: number;
}

export function buildBraveSearchParams(query: string, count: number, opts: BraveSearchOptions): { url: string } {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("count", String(Math.min(count, 20)));

  if (opts.freshness) params.set("freshness", opts.freshness);
  if (opts.country) params.set("country", opts.country);
  if (opts.searchLang) params.set("search_lang", opts.searchLang);
  if (opts.extraSnippets) params.set("extra_snippets", "true");
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));

  return { url: `https://api.search.brave.com/res/v1/web/search?${params.toString()}` };
}

// ─── Response parser ───────────────────────────────────────────

export function parseBraveResponse(body: string, maxResults: number): WebSearchResult[] {
  try {
    const data = JSON.parse(body);
    const web = data.web?.results ?? [];
    return web.slice(0, maxResults).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
      engine: "brave",
    }));
  } catch {
    return [];
  }
}

// ─── Public API ────────────────────────────────────────────────

export async function searchBrave(
  query: string,
  maxResults: number,
  cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  const apiKey = resolveBraveApiKey(cred);
  if (!apiKey) return [];

  const { url } = buildBraveSearchParams(query, maxResults, {});
  const { status, body } = await fetchUrl(url, {
    timeout: 15_000,
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "X-Subscription-Token": apiKey,
      "User-Agent": DDG_USER_AGENT,
    },
  });

  if (status !== 200) return [];
  return parseBraveResponse(body, maxResults);
}

export async function search(
  query: string,
  opts: WebSearchOptions,
  cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await rateLimiter.waitIfNeeded("brave");
  const results = await searchBrave(query, opts.maxResults ?? 5, cred);
  rateLimiter.recordCall("brave");
  return results;
}
