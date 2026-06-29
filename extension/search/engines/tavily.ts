import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../search-providers.js";
import { waitIfNeeded } from "./utils.js";
import { searchTavily } from "../web-search.js";

export { searchTavily };

export async function search(
  query: string,
  opts: WebSearchOptions,
  _cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("tavily");
  return searchTavily(query, opts.maxResults ?? 5);
}
