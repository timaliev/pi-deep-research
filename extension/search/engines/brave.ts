import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../search-providers.js";
import { waitIfNeeded } from "./utils.js";
import { searchBrave } from "../web-search.js";

export { searchBrave };

export async function search(
  query: string,
  opts: WebSearchOptions,
  cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("brave");
  return searchBrave(query, opts.maxResults ?? 5, cred);
}
