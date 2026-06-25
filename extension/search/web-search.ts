/**
 * Multi-engine web search with retry logic and rate-limit aware DuckDuckGo scraping.
 * Based on the ddg-search approach (https://github.com/Djarvur/ddg-search):
 * - Uses honest bot User-Agent (not browser disguise)
 * - `html.duckduckgo.com/html` endpoint with CSS class parsing
 * - Exponential backoff with jitter on rate limits
 * - Rate limit detection via HTTP status + HTML content analysis
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

// --- Constants (from ddg-search config) ---
const DDG_BASE_URL = "https://html.duckduckgo.com/html";
const DDG_USER_AGENT = "Mozilla/5.0 (compatible; web-search/1.0)";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const BACKOFF_MULTIPLIER = 2.0;
const JITTER_MS = 500;

// --- Rate limit indicators in HTML ---
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

// --- Search result type ---
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: string;
}

// --- HTTP fetch helper ---
interface FetchResult {
  status: number;
  body: string;
}

function fetchUrlWithMethod(
  method: string,
  urlStr: string,
  formData: Record<string, string> | null,
  opts?: { headers?: Record<string, string>; timeout?: number },
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const reqFn = urlStr.startsWith("https:") ? httpsRequest : httpRequest;
    const parsedUrl = new URL(urlStr);

    const reqHeaders: Record<string, string> = {
      "User-Agent": opts?.headers?.["User-Agent"] ?? DDG_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      ...Object.fromEntries(
        Object.entries(opts?.headers ?? {}).filter(([k]) => k !== "User-Agent"),
      ),
    };

    if (method === "POST" && formData) {
      const encoded = new URLSearchParams(formData).toString();
      reqHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      reqHeaders["Content-Length"] = String(Buffer.byteLength(encoded));
    }

    const req = reqFn(
      urlStr,
      {
        method,
        headers: reqHeaders,
        timeout: opts?.timeout ?? 15_000,
      },
      (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          const loc = res.headers.location;
          if (loc) {
            res.resume();
            const redirectUrl = loc.startsWith("/")
              ? `${parsedUrl.protocol}//${parsedUrl.host}${loc}`
              : loc;
            fetchUrlWithMethod("GET", redirectUrl, null, opts).then(resolve, reject);
            return;
          }
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout: ${urlStr}`));
    });
    req.on("error", reject);

    if (method === "POST" && formData) {
      const body = new URLSearchParams(formData).toString();
      req.write(body);
    }
    req.end();
  });
}

function postForm(
  urlStr: string,
  formData: Record<string, string>,
  opts?: { headers?: Record<string, string>; timeout?: number },
): Promise<FetchResult> {
  return fetchUrlWithMethod("POST", urlStr, formData, opts);
}

function fetchUrl(
  urlStr: string,
  opts?: { headers?: Record<string, string>; timeout?: number },
): Promise<FetchResult> {
  return fetchUrlWithMethod("GET", urlStr, null, opts);
}

// --- Sleep helper ---
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Exponential backoff with jitter ---
function calcDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  let delay = baseDelay * Math.pow(BACKOFF_MULTIPLIER, attempt);
  if (delay > maxDelay) delay = maxDelay;
  delay += Math.random() * JITTER_MS;
  return Math.floor(delay);
}

// --- DuckDuckGo HTML endpoint search ---

/** Check if HTML response indicates rate limiting or CAPTCHA */
function isRateLimited(status: number, body: string): boolean {
  if (status === 202 || status === 429 || status >= 500) return true;

  const lowerBody = body.toLowerCase();
  for (const indicator of RATE_LIMIT_INDICATORS) {
    if (lowerBody.includes(indicator)) return true;
  }

  return false;
}

/** Decode HTML entities */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Parse DDG HTML results using CSS classes .result__a, .result__snippet */
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

/** Search DuckDuckGo with retry + exponential backoff */
async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  baseDelay: number = DEFAULT_BASE_DELAY_MS,
  maxDelay: number = DEFAULT_MAX_DELAY_MS,
): Promise<WebSearchResult[]> {
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

// --- Brave Search API (optional - needs BRAVE_API_KEY env var) ---
async function searchBrave(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
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

// --- SearXNG public instances ---
const SEARXNG_INSTANCES = ["https://searx.be", "https://search.sapti.me"];

async function searchSearXNG(
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

// --- Deduplication ---
function deduplicateByUrl(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const r of results) {
    const normalized = r.url
      .toLowerCase()
      .replace(/\/$/, "")
      .replace(/^https?:\/\/(www\.)?/, "");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(r);
    }
  }
  return out;
}

// --- Per-engine rate limiter ---
const engineLastCall: Record<string, number> = {};
const ENGINE_MIN_DELAY: Record<string, number> = {
  duckduckgo: 1500,
  searxng: 2000,
  brave: 500,
};

async function waitIfNeeded(engine: string): Promise<void> {
  const last = engineLastCall[engine] ?? 0;
  const minDelay = ENGINE_MIN_DELAY[engine] ?? 1000;
  const elapsed = Date.now() - last;
  if (elapsed < minDelay) {
    const waitTime = minDelay - elapsed + Math.random() * 500;
    await sleep(waitTime);
  }
}

// --- Public API ---

export type SearchEngine = "duckduckgo" | "brave" | "searxng";

export interface WebSearchOptions {
  query: string;
  maxResults?: number;
  engines?: SearchEngine[];
  compare?: boolean;
  signal?: AbortSignal;
  onUpdate?: (update: {
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }) => void;
}

export interface WebSearchOutput {
  markdown: string;
  details: {
    engines: string[];
    totalRaw: number;
    totalDeduped: number;
    perEngine: Record<string, WebSearchResult[]>;
    errors: string[];
    compareMode: boolean;
  };
}

export async function multiEngineWebSearch(
  opts: WebSearchOptions,
): Promise<WebSearchOutput> {
  const query = opts.query;
  const maxResults = opts.maxResults ?? 5;
  const engines: SearchEngine[] = opts.engines ?? ["duckduckgo"];
  const compareMode = opts.compare ?? false;

  if (!query || query.trim().length === 0) {
    throw new Error("Error: query is required and must not be empty.");
  }

  opts.onUpdate?.({
    content: [
      {
        type: "text",
        text: `Searching "${query}" via [${engines.join(", ")}]...`,
      },
    ],
    details: { phase: "searching", engine: engines[0] },
  });

  const engineFns: Record<
    string,
    (q: string, n: number) => Promise<WebSearchResult[]>
  > = {
    duckduckgo: (q, n) => searchDuckDuckGo(q, n),
    brave: searchBrave,
    searxng: searchSearXNG,
  };

  const allResults: WebSearchResult[] = [];
  const perEngine: Record<string, WebSearchResult[]> = {};
  const errors: string[] = [];

  for (const engine of engines) {
    if (opts.signal?.aborted) break;

    const fn = engineFns[engine];
    if (!fn) continue;

    await waitIfNeeded(engine);

    try {
      opts.onUpdate?.({
        content: [{ type: "text", text: `Querying ${engine}...` }],
        details: { phase: "searching", engine },
      });

      const results = await fn(query, maxResults);
      engineLastCall[engine] = Date.now();
      perEngine[engine] = results;
      allResults.push(...results);

      opts.onUpdate?.({
        content: [
          {
            type: "text",
            text: `${engine}: ${results.length} results`,
          },
        ],
        details: { phase: "done", engine, count: results.length },
      });
    } catch (err: any) {
      errors.push(`${engine}: ${err.message}`);
      opts.onUpdate?.({
        content: [
          {
            type: "text",
            text: `${engine}: failed — ${err.message}`,
          },
        ],
        details: { phase: "error", engine, error: err.message },
      });
    }
  }

  // Build output markdown
  let text = "";

  if (compareMode && engines.length > 1) {
    for (const engine of engines) {
      const results = perEngine[engine] ?? [];
      text += `\n## ${engine} (${results.length} results)\n\n`;
      if (results.length === 0) text += "_No results_\n";
      for (const r of results) {
        text += `- **${r.title}**\n  ${r.url}\n  ${r.snippet}\n\n`;
      }
    }
  } else {
    const deduped = deduplicateByUrl(allResults);
    text += `## Web Search: "${query}"\n`;
    text += `Engines: ${engines.join(", ")} | Results: ${deduped.length} (${allResults.length} raw)\n\n`;
    if (deduped.length === 0) text += "_No results found._\n";
    for (const r of deduped) {
      text += `- **${r.title}**\n  ${r.url}\n  ${r.snippet} _(via ${r.engine})_\n\n`;
    }
  }

  if (errors.length > 0) {
    text += `\n---\n## Errors\n${errors.map((e) => `- ${e}`).join("\n")}\n`;
  }

  const deduped = deduplicateByUrl(allResults);

  return {
    markdown: text,
    details: {
      engines,
      totalRaw: allResults.length,
      totalDeduped: compareMode ? allResults.length : deduped.length,
      perEngine,
      errors,
      compareMode,
    },
  };
}
