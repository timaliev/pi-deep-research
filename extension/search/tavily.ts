import type { SearchProvider, SearchResult } from "./provider.js";

export type FetchFn = typeof globalThis.fetch;

const TAVILY_API_URL = "https://api.tavily.com/search";

/**
 * Tavily Search API provider.
 * Requires a Tavily API key (https://app.tavily.com).
 * Higher quality results than DuckDuckGo, with AI-optimized snippets.
 */
export class TavilyProvider implements SearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = globalThis.fetch
  ) {}

  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const response = await this.fetchFn(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    });

    const data = (await response.json()) as TavilyResponse;

    if (!response.ok) {
      const detail = (data as Record<string, unknown>).detail;
      const errMsg = typeof detail === "object" && detail !== null
        ? String((detail as Record<string, string>).error ?? "")
        : String((data as TavilyError).error ?? "");
      throw new Error(`Tavily API error (${response.status}): ${errMsg || response.statusText}`);
    }

    const results = data as TavilySuccess;
    return (results.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content: string | null;
}

interface TavilySuccess {
  query: string;
  results: TavilyResult[];
  response_time: number;
}

interface TavilyError {
  error: string;
}

type TavilyResponse = TavilySuccess | TavilyError;
