import type { SearchProviderCredentials } from "./search-providers.js";

export interface BraveSearchOptions {
  freshness?: string;
  country?: string;
  searchLang?: string;
  extraSnippets?: boolean;
  offset?: number;
}

/** Resolve Brave API key: process.env first, then credentials from settings. */
export function resolveBraveApiKey(
  cred?: SearchProviderCredentials,
): string | undefined {
  if (process.env.BRAVE_API_KEY) return process.env.BRAVE_API_KEY;
  return cred?.get("brave", "apiKey");
}

/** Build Brave Web Search URL with all supported parameters. */
export function buildBraveSearchParams(
  query: string,
  count: number,
  opts: BraveSearchOptions,
): { url: string } {
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

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: string;
}

/** Parse Brave API JSON response into WebSearchResult array. */
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
