import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../search-providers.js";
import { waitIfNeeded } from "./utils.js";
import { searchSearXNG } from "../web-search.js";

export { searchSearXNG };

export async function search(
  query: string,
  opts: WebSearchOptions,
  _cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("searxng");
  return searchSearXNG(query, opts.maxResults ?? 5);
}
