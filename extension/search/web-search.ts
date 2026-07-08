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
import type { Logger } from "./logger.js";
import type { SearchProviderCredentials } from "../search-providers.js";

export const DDG_USER_AGENT = "Mozilla/5.0 (compatible; web-search/1.0)";

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

export function postForm(
  urlStr: string,
  formData: Record<string, string>,
  opts?: { headers?: Record<string, string>; timeout?: number },
): Promise<FetchResult> {
  return fetchUrlWithMethod("POST", urlStr, formData, opts);
}

export function fetchUrl(
  urlStr: string,
  opts?: { headers?: Record<string, string>; timeout?: number },
): Promise<FetchResult> {
  return fetchUrlWithMethod("GET", urlStr, null, opts);
}

// --- Sleep helper ---
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Brave Search API (optional - needs BRAVE_API_KEY env var or settings) ---
/** Decode HTML entities (shared by engine parsers) */
export function decodeHtmlEntities(text: string): string {
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
export const engineLastCall: Record<string, number> = {};
const ENGINE_MIN_DELAY: Record<string, number> = {
  duckduckgo: 2500,
  searxng: 2000,
  brave: 500,
  tavily: 200,
  yandex: 500,
};

export async function waitIfNeeded(engine: string): Promise<void> {
  const last = engineLastCall[engine] ?? 0;
  const minDelay = ENGINE_MIN_DELAY[engine] ?? 1000;
  const elapsed = Date.now() - last;
  if (elapsed < minDelay) {
    const waitTime = minDelay - elapsed + Math.random() * 500;
    await sleep(waitTime);
  }
}

// --- Public API ---

export type SearchEngine = "duckduckgo" | "brave" | "searxng" | "tavily" | "yandex";

export type EngineSearchFn = (
  query: string,
  opts: WebSearchOptions,
  cred?: SearchProviderCredentials,
) => Promise<WebSearchResult[]>;

const ENGINE_LOADERS: Record<SearchEngine, () => Promise<{ search: EngineSearchFn }>> = {
  duckduckgo: async () => (await import("./engines/duckduckgo.js")),
  brave: async () => (await import("./engines/brave.js")),
  tavily: async () => (await import("./engines/tavily.js")),
  yandex: async () => (await import("./engines/yandex.js")),
  searxng: async () => (await import("./engines/searxng.js")),
};

export function createEngineSearchFn(engine: SearchEngine): EngineSearchFn {
  const loader = ENGINE_LOADERS[engine];
  if (!loader) {
    return async () => [];
  }
  // Return a sync proxy — the actual dynamic import happens on first call
  let cached: EngineSearchFn | null = null;
  return async (query, opts, cred) => {
    if (!cached) {
      const mod = await loader();
      cached = mod.search;
    }
    return cached(query, opts, cred);
  };
}

export interface WebSearchOptions {
  query: string;
  maxResults?: number;
  engines?: SearchEngine[];
  compare?: boolean;
  signal?: AbortSignal;
  credentials?: SearchProviderCredentials;
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

interface SearchCallbacks {
  signal?: AbortSignal;
  credentials?: SearchProviderCredentials;
  onUpdate?: (update: {
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }) => void;
  logger?: Logger;
}

/** Internal shared engine loop — called by both searchWeb and multiEngineWebSearch. */
async function searchAllEngines(
  query: string,
  maxResults: number,
  engines: SearchEngine[],
  signal: AbortSignal | undefined,
  credentials: SearchProviderCredentials | undefined,
  onUpdate: SearchCallbacks["onUpdate"],
  logger: Logger | undefined,
): Promise<{
  allResults: WebSearchResult[];
  perEngine: Record<string, WebSearchResult[]>;
  errors: string[];
}> {
  const engineFns: Record<string, EngineSearchFn> = {};
  for (const engine of engines) {
    engineFns[engine] = createEngineSearchFn(engine);
  }

  const allResults: WebSearchResult[] = [];
  const perEngine: Record<string, WebSearchResult[]> = {};
  const errors: string[] = [];
  const searchOpts: WebSearchOptions = { query, maxResults };

  for (const engine of engines) {
    if (signal?.aborted) break;

    const fn = engineFns[engine];
    if (!fn) continue;

    await waitIfNeeded(engine);

    try {
      const startMs = Date.now();
      onUpdate?.({
        content: [{ type: "text", text: `Querying ${engine}...` }],
        details: { phase: "searching", engine },
      });

      const results = await fn(query, searchOpts, credentials);
      const elapsedMs = Date.now() - startMs;
      engineLastCall[engine] = Date.now();
      perEngine[engine] = results;
      allResults.push(...results);

      logger?.event("search_executed", {
        query,
        engine,
        resultCount: results.length,
        elapsedMs,
      });

      onUpdate?.({
        content: [{ type: "text", text: `${engine}: ${results.length} results` }],
        details: { phase: "done", engine, count: results.length },
      });
    } catch (err: any) {
      errors.push(`${engine}: ${err.message}`);
      logger?.event("search_failed", {
        query,
        engine,
        error: err.message,
      });
      onUpdate?.({
        content: [{ type: "text", text: `${engine}: failed — ${err.message}` }],
        details: { phase: "error", engine, error: err.message },
      });
    }
  }

  return { allResults, perEngine, errors };
}

/** Format per-engine results as markdown. */
function formatSearchMarkdown(
  query: string,
  engines: SearchEngine[],
  allResults: WebSearchResult[],
  perEngine: Record<string, WebSearchResult[]>,
  errors: string[],
  compareMode: boolean,
): string {
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

  return text;
}

/**
 * Raw multi-engine web search. Returns deduped results, no markdown.
 * Used by the research pipeline (plan_research, run_research).
 */
export async function searchWeb(
  query: string,
  maxResults: number = 5,
  engines: SearchEngine[] = ["duckduckgo"],
  callbacks?: SearchCallbacks,
): Promise<WebSearchResult[]> {
  if (!query || query.trim().length === 0) {
    throw new Error("Error: query is required and must not be empty.");
  }

  callbacks?.onUpdate?.({
    content: [
      { type: "text", text: `Searching "${query}" via [${engines.join(", ")}]...` },
    ],
    details: { phase: "searching", engine: engines[0] },
  });

  const { allResults } = await searchAllEngines(
    query, maxResults, engines,
    callbacks?.signal, callbacks?.credentials,
    callbacks?.onUpdate, callbacks?.logger,
  );

  return deduplicateByUrl(allResults);
}

/**
 * Multi-engine web search with markdown formatting.
 * Used by the web_search tool for user-facing output.
 */
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

  const { allResults, perEngine, errors } = await searchAllEngines(
    query, maxResults, engines,
    opts.signal, opts.credentials,
    opts.onUpdate, undefined,
  );

  const text = formatSearchMarkdown(query, engines, allResults, perEngine, errors, compareMode);
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
