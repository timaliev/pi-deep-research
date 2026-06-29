import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../search-providers.js";
import { waitIfNeeded } from "./utils.js";
import { searchDuckDuckGo } from "../web-search.js";

export { searchDuckDuckGo };

export async function search(
  query: string,
  opts: WebSearchOptions,
  _cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("duckduckgo");
  return searchDuckDuckGo(query, opts.maxResults ?? 5, opts.maxRetries, opts.baseDelay, opts.maxDelay);
}
