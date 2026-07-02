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
import { resolveBraveApiKey, buildBraveSearchParams, parseBraveResponse } from "../brave-search.js";
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

function fetchUrl(
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

// --- Tavily Search API ---
const TAVILY_API_URL = "https://api.tavily.com/search";

export async function searchTavily(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  return await tavilyPostRequest(apiKey, query, maxResults);
}

async function tavilyPostRequest(
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const body = JSON.stringify({
    api_key: apiKey,
    query,
    search_depth: "basic",
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  });

  return new Promise((resolve) => {
    const parsedUrl = new URL(TAVILY_API_URL);
    const req = httpsRequest(
      TAVILY_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
          "User-Agent": DDG_USER_AGENT,
        },
        timeout: 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            const results = (data.results ?? []).slice(0, maxResults);
            resolve(
              results.map((r: any) => ({
                title: r.title ?? "",
                url: r.url ?? "",
                snippet: r.content ?? r.snippet ?? "",
                engine: "tavily",
              })),
            );
          } catch {
            resolve([]);
          }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); resolve([]); });
    req.on("error", () => resolve([]));
    req.write(body);
    req.end();
  });
}

// --- Yandex Search API ---
const YANDEX_SEARCH_URL = "https://searchapi.api.cloud.yandex.net/v2/web/searchAsync";
const YANDEX_OPERATION_URL = "https://operation.api.cloud.yandex.net/operations/";
const YANDEX_IAM_URL = "https://iam.api.cloud.yandex.net/iam/v1/tokens";

interface YandexIamToken {
  iamToken: string;
  expiresAt: string;
}

let yandexIamCache: YandexIamToken | null = null;

async function yandexGetIamToken(oauthToken: string): Promise<string> {
  if (yandexIamCache && new Date(yandexIamCache.expiresAt).getTime() > Date.now() + 60_000) {
    return yandexIamCache.iamToken;
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ yandexPassportOauthToken: oauthToken });
    const req = httpsRequest(
      YANDEX_IAM_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            yandexIamCache = { iamToken: data.iamToken, expiresAt: data.expiresAt };
            resolve(data.iamToken);
          } catch {
            reject(new Error("Failed to get Yandex IAM token"));
          }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("IAM token timeout")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function yandexSearchSubmit(
  iamToken: string,
  folderId: string,
  query: string,
  maxResults: number,
): Promise<string> {
  const body = JSON.stringify({
    query: { searchType: "SEARCH_TYPE_COM", queryText: query, page: 0 },
    groupSpec: { groupsOnPage: maxResults },
    region: "225",
    l10N: "en",
    folderId,
    responseFormat: "FORMAT_XML",
  });

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      YANDEX_SEARCH_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${iamToken}`,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            resolve(data.id);
          } catch {
            reject(new Error("Failed to submit Yandex search"));
          }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Search submit timeout")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function yandexPollOperation(iamToken: string, operationId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      `${YANDEX_OPERATION_URL}${operationId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${iamToken}` },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            if (!data.done) {
              resolve("");
              return;
            }
            const rawData = data.response?.rawData;
            if (!rawData) {
              reject(new Error("No rawData in response"));
              return;
            }
            resolve(Buffer.from(rawData, "base64").toString("utf-8"));
          } catch {
            reject(new Error("Failed to poll operation"));
          }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Poll timeout")); });
    req.on("error", reject);
    req.end();
  });
}

function parseYandexXml(xml: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const groupRegex = /<group[\s\S]*?<\/group>/g;
  const urlRegex = /<url>([^<]+)<\/url>/;
  const titleRegex = /<title>([^<]+)<\/title>/;
  const headlineRegex = /<headline>([^<]+)<\/headline>/;

  let match;
  while ((match = groupRegex.exec(xml)) !== null && results.length < maxResults) {
    const groupXml = match[0];
    const urlM = groupXml.match(urlRegex);
    const titleM = groupXml.match(titleRegex);
    const headlineM = groupXml.match(headlineRegex);

    if (urlM) {
      results.push({
        title: decodeHtmlEntities(titleM?.[1] ?? headlineM?.[1] ?? ""),
        url: urlM[1],
        snippet: decodeHtmlEntities(headlineM?.[1] ?? ""),
        engine: "yandex",
      });
    }
  }
  return results;
}

export async function searchYandex(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const oauthToken = process.env.YANDEX_OAUTH_TOKEN;
  const folderId = process.env.YANDEX_FOLDER_ID;
  if (!oauthToken || !folderId) return [];

  try {
    const iamToken = await yandexGetIamToken(oauthToken);
    const operationId = await yandexSearchSubmit(iamToken, folderId, query, maxResults);

    for (let i = 0; i < 10; i++) {
      await sleep(1000 + i * 500);
      const xml = await yandexPollOperation(iamToken, operationId);
      if (xml) return parseYandexXml(xml, maxResults);
    }
    return [];
  } catch {
    return [];
  }
}

// --- SearXNG public instances ---
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

/**
 * Raw multi-engine web search. Returns deduped results, no markdown.
 * Used by the research pipeline (plan_research, run_research) and
 * by multiEngineWebSearch (which adds formatting).
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

  const engineFns: Record<string, EngineSearchFn> = {};
  for (const engine of engines) {
    engineFns[engine] = createEngineSearchFn(engine);
  }

  const allResults: WebSearchResult[] = [];
  const searchOpts: WebSearchOptions = { query, maxResults };

  for (const engine of engines) {
    if (callbacks?.signal?.aborted) break;

    const fn = engineFns[engine];
    if (!fn) continue;

    await waitIfNeeded(engine);

    try {
      const startMs = Date.now();
      callbacks?.onUpdate?.({
        content: [{ type: "text", text: `Querying ${engine}...` }],
        details: { phase: "searching", engine },
      });

      const results = await fn(query, searchOpts, callbacks?.credentials);
      const elapsedMs = Date.now() - startMs;
      engineLastCall[engine] = Date.now();
      allResults.push(...results);

      callbacks?.logger?.event("search_executed", {
        query,
        engine,
        resultCount: results.length,
        elapsedMs,
      });

      callbacks?.onUpdate?.({
        content: [{ type: "text", text: `${engine}: ${results.length} results` }],
        details: { phase: "done", engine, count: results.length },
      });
    } catch (err: any) {
      callbacks?.logger?.event("search_failed", {
        query,
        engine,
        error: err.message,
      });
      callbacks?.onUpdate?.({
        content: [{ type: "text", text: `${engine}: failed — ${err.message}` }],
        details: { phase: "error", engine, error: err.message },
      });
    }
  }

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

  // Collect per-engine results separately for compare mode
  const engineFns: Record<string, EngineSearchFn> = {};
  for (const engine of engines) {
    engineFns[engine] = createEngineSearchFn(engine);
  }

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

      const results = await fn(query, opts, opts.credentials);
      engineLastCall[engine] = Date.now();
      perEngine[engine] = results;
      allResults.push(...results);

      opts.onUpdate?.({
        content: [{ type: "text", text: `${engine}: ${results.length} results` }],
        details: { phase: "done", engine, count: results.length },
      });
    } catch (err: any) {
      errors.push(`${engine}: ${err.message}`);
      opts.onUpdate?.({
        content: [{ type: "text", text: `${engine}: failed — ${err.message}` }],
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
