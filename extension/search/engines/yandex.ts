import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../search-providers.js";
import { waitIfNeeded } from "./utils.js";
import { searchYandex } from "../web-search.js";

export { searchYandex };

export async function search(
  query: string,
  opts: WebSearchOptions,
  cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("yandex");
  return searchYandex(query, opts.maxResults ?? 5, cred);
}
