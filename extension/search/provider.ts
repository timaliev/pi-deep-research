export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  /** Execute a web search. Returns up to maxResults results. */
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
}
