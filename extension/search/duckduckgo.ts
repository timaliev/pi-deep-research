import type { SearchProvider, SearchResult } from "./provider.js";

export type FetchFn = typeof globalThis.fetch;

/**
 * DuckDuckGo search provider.
 * Uses duck-duck-scrape for primary search (VQD-based, anti-detection),
 * falls back to HTML scraping. No API key required.
 *
 * Accepts an optional `fetchFn` for dependency injection (useful in tests).
 */
export class DuckDuckGoProvider implements SearchProvider {
  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    // In test mode (custom fetchFn), use HTML scraping directly
    if (this.fetchFn !== globalThis.fetch) {
      return this.searchWithHtml(query, maxResults);
    }

    // Production: try duck-duck-scrape first, fall back to HTML
    try {
      return await this.searchWithDuckDuckScrape(query, maxResults);
    } catch {
      return this.searchWithHtml(query, maxResults);
    }
  }

  private async searchWithDuckDuckScrape(
    query: string,
    maxResults: number
  ): Promise<SearchResult[]> {
    const { search } = await import("duck-duck-scrape");
    const response = await withRetry(
      () =>
        search(query, {
          safeSearch: "OFF",
          locale: "en-us",
          region: "wt-wt",
        }),
      { maxRetries: 2, baseDelayMs: 2000 }
    );

    const results = response.results.slice(0, maxResults);
    return results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? "",
    }));
  }

  private async searchWithHtml(
    query: string,
    maxResults: number
  ): Promise<SearchResult[]> {
    const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
    const formData = new URLSearchParams({ q: query });

    const response = await this.fetchFn(DDG_HTML_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(
        `DuckDuckGo search returned ${response.status}: ${response.statusText}`
      );
    }

    const html = await response.text();
    return this.parseResults(html, maxResults);
  }

  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    const resultBlockRe =
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while (
      (match = resultBlockRe.exec(html)) !== null &&
      results.length < maxResults
    ) {
      const url = this.cleanUrl(match[1]);
      const title = this.stripHtml(match[2]);
      const snippet = this.stripHtml(match[3]);
      if (title && url) results.push({ title, url, snippet });
    }
    return results;
  }

  private cleanUrl(url: string): string {
    let normalized = url;
    if (normalized.startsWith("//")) normalized = "https:" + normalized;
    try {
      const parsed = new URL(normalized);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    } catch {
      // not a valid URL, return as-is
    }
    return url;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  }
}

/** Retry a function with exponential backoff. */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries: number; baseDelayMs: number }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxRetries) {
        const delay = opts.baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
