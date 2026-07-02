/**
 * Tavily Search API adapter.
 * Uses the Tavily REST API with API key authentication.
 */

import { request as httpsRequest } from "node:https";
import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../search-providers.js";
import { DDG_USER_AGENT } from "../web-search.js";
import { waitIfNeeded } from "./utils.js";

const TAVILY_API_URL = "https://api.tavily.com/search";

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

export async function searchTavily(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  return await tavilyPostRequest(apiKey, query, maxResults);
}

export async function search(
  query: string,
  opts: WebSearchOptions,
  _cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("tavily");
  return searchTavily(query, opts.maxResults ?? 5);
}
