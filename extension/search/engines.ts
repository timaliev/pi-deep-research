/**
 * Single source of truth for search engine metadata.
 *
 * ALL_ENGINES is the canonical list. SearchEngine is derived from it.
 * Adding a new engine: add to ALL_ENGINES + ENGINE_META + create adapter file.
 * All consumers (type, loaders, prompts, schemas, defaults) derive from this file.
 */
export const ALL_ENGINES = ["duckduckgo", "brave", "searxng", "tavily", "yandex"] as const;
export type SearchEngine = (typeof ALL_ENGINES)[number];

export interface EngineMeta {
  /** Environment variable for the API key (empty string for free engines). */
  envKey: string;
  /** Whether the engine works without an API key. */
  free: boolean;
  /** Credential key used with SearchProviderCredentials.get(). */
  credKey?: string;
  /** Additional required env vars beyond the main API key. */
  extraEnvVars?: string[];
}

export const ENGINE_META: Record<SearchEngine, EngineMeta> = {
  duckduckgo: { envKey: "", free: true },
  brave: { envKey: "BRAVE_API_KEY", free: false, credKey: "apiKey" },
  searxng: { envKey: "", free: true },
  tavily: { envKey: "TAVILY_API_KEY", free: false, credKey: "apiKey" },
  yandex: {
    envKey: "YANDEX_OAUTH_TOKEN",
    free: false,
    credKey: "oauthToken",
    extraEnvVars: ["YANDEX_FOLDER_ID"],
  },
};
