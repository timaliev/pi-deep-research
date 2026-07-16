import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ALL_ENGINES, type SearchEngine } from "../search/engines.js";
import { multiEngineWebSearch } from "../search/web-search.js";
import type { SearchProviderCredentials } from "../settings-context.js";

export function createWebSearchTool(searchCred: SearchProviderCredentials) {
  return {
    name: "deep_web_search",
    label: "Web Search",
    description: `Search the web via DuckDuckGo, Brave, Tavily, Yandex, or SearXNG with exponential backoff retry.
Use compare mode to cross-check results across engines.`,
    promptSnippet:
      "Search the web using DuckDuckGo, Brave, Tavily, Yandex, or SearXNG with honest bot User-Agent and exponential backoff retry.",
    promptGuidelines: [
      "Use deep_web_search for finding sources, current information, or web research. Multiple engines can be used with compare mode to cross-check results.",
      "deep_web_search uses exponential backoff with jitter to handle rate limits. Specify engines to use: duckduckgo, brave, tavily, yandex, searxng.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      max_results: Type.Optional(Type.Number({ description: "Max results per engine (default 5)" })),
      engines: Type.Optional(
        Type.Array(StringEnum(ALL_ENGINES), {
          description: "Search engines to query (default: ['duckduckgo'])",
        }),
      ),
      compare: Type.Optional(
        Type.Boolean({ description: "If true, show results per engine without deduplication (default: false)" }),
      ),
    }),

    async execute(_toolCallId: string, params: any, signal: any, onUpdate: any) {
      const query = params.query as string;
      const maxResults = (params.max_results as number) ?? 5;
      const engines = (params.engines as SearchEngine[]) ?? ["duckduckgo"];
      const compareMode = (params.compare as boolean) ?? false;

      if (!query || query.trim().length === 0) {
        return {
          content: [{ type: "text", text: "Error: query is required and must not be empty." }],
          details: {},
        };
      }

      const output = await multiEngineWebSearch({
        query,
        maxResults,
        engines,
        compare: compareMode,
        signal,
        credentials: searchCred,
        onUpdate,
      });

      return {
        content: [{ type: "text", text: output.markdown }],
        details: output.details,
      };
    },
  };
}
