/**
 * Brave Search API adapter.
 * Uses Brave's Web Search API with subscription-token auth.
 */

import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../search-providers.js";
import { DDG_USER_AGENT, fetchUrl } from "../web-search.js";
import { resolveBraveApiKey, buildBraveSearchParams, parseBraveResponse } from "../../brave-search.js";
import { waitIfNeeded } from "./utils.js";

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

export async function search(
  query: string,
  opts: WebSearchOptions,
  cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("brave");
  return searchBrave(query, opts.maxResults ?? 5, cred);
}
