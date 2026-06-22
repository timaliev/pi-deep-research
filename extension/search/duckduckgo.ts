import type { SearchProvider, SearchResult } from "./provider.js";

const DDG_HTML_URL = "https://html.duckduckgo.com/html/";

export type FetchFn = typeof globalThis.fetch;

/**
 * DuckDuckGo search provider.
 * Uses the DuckDuckGo HTML search endpoint (no API key required).
 * This is a free, zero-config search backend.
 *
 * Accepts an optional `fetchFn` for dependency injection (useful in tests).
 */
export class DuckDuckGoProvider implements SearchProvider {
  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
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

    // DuckDuckGo HTML results use <a class="result__a"> for title/url
    // and <a class="result__snippet"> for snippet.
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

      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    return results;
  }

  private cleanUrl(url: string): string {
    // Protocol-relative URLs need a scheme for URL parsing
    let normalized = url;
    if (normalized.startsWith("//")) {
      normalized = "https:" + normalized;
    }

    // DDG wraps URLs in its redirect; extract the real URL from the 'uddg' param
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
