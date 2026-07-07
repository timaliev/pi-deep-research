export interface ScrapedPage {
  url: string;
  title: string;
  content: string; // readable text, stripped of HTML
}

export interface Scraper {
  /** Fetch a URL and extract readable text content. */
  scrape(url: string): Promise<ScrapedPage>;
}

type FetchFn = typeof globalThis.fetch;

/**
 * Web scraper that fetches a URL and extracts readable text.
 * Accepts an optional fetch function for dependency injection in tests.
 */
export class WebScraper implements Scraper {
  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  async scrape(url: string): Promise<ScrapedPage> {
    const response = await this.fetchFn(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`
      );
    }

    // Determine encoding: prefer Content-Type charset, fall back to meta tag detection
    const contentType = response.headers.get("Content-Type") ?? "";
    const headerCharset = /charset\s*=\s*([^\s;]+)/i.exec(contentType)?.[1];

    let html: string;
    if (headerCharset) {
      // Server specified charset — use it
      html = await response.text();
    } else {
      // No charset header — read raw bytes, detect encoding from <meta> tag
      const bodyBytes = new Uint8Array(await response.arrayBuffer());
      // Try UTF-8 first to extract meta tag
      const utf8Preview = new TextDecoder("utf-8", { fatal: false }).decode(bodyBytes.slice(0, 4096));
      const metaCharset = this.detectMetaCharset(utf8Preview);
      if (metaCharset && metaCharset !== "utf-8") {
        try {
          html = new TextDecoder(metaCharset).decode(bodyBytes);
        } catch {
          html = new TextDecoder("utf-8").decode(bodyBytes);
        }
      } else {
        html = new TextDecoder("utf-8").decode(bodyBytes);
      }
    }

    const title = this.extractTitle(html);
    const content = this.extractContent(html);

    return { url, title, content };
  }

  /** Extract charset from HTML <meta> tag. Returns undefined if not found. */
  private detectMetaCharset(html: string): string | undefined {
    const match = /<meta[^>]+charset\s*=\s*["']?([^"'\s>]+)/i.exec(html);
    return match?.[1]?.toLowerCase();
  }

  private extractTitle(html: string): string {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!match) return "";
    return this.decodeEntities(match[1].trim());
  }

  private extractContent(html: string): string {
    // Remove non-content elements
    let text = html;

    // Remove scripts, styles, and nav/header/footer regions
    for (const tag of [
      "script",
      "style",
      "nav",
      "header",
      "footer",
      "noscript",
      "iframe",
    ]) {
      text = text.replace(
        new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
        ""
      );
    }

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, "");

    // Collapse whitespace around block elements to preserve paragraph boundaries
    text = text.replace(/<\/(p|div|article|section|li|h[1-6]|blockquote|pre|br)[^>]*>/gi, "\n");

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]*>/g, "");

    // Decode entities
    text = this.decodeEntities(text);

    // Collapse whitespace: normalize newlines, trim lines, remove blank lines
    text = text
      .split("\n")
      .map((line) => line.replace(/[\t ]+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");

    return text;
  }

  private decodeEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
}
