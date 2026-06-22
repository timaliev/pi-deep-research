import type { SearchProvider, SearchResult } from "./provider.js";

export type FetchFn = typeof globalThis.fetch;

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

/**
 * Brave Search API provider.
 * Free tier: 2,000 queries/month. Requires an API key from https://brave.com/search/api/.
 */
export class BraveProvider implements SearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = globalThis.fetch
  ) {}

  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${Math.min(maxResults, 20)}`;

    const response = await this.fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      const detail =
        (data as Record<string, unknown>).error ??
        (data as Record<string, unknown>).detail ??
        response.statusText;
      throw new Error(`Brave Search API error (${response.status}): ${String(detail)}`);
    }

    const web = (data as BraveResponse).web;
    const results = web?.results ?? [];

    return results.slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  language?: string;
}

interface BraveResponse {
  web?: {
    type: string;
    results: BraveWebResult[];
    family_friendly: boolean;
  };
}
