/**
 * Search provider credentials — resolves API keys from settings.json and env vars.
 *
 * Env vars take priority over settings.json values.
 * Extracted from settings-context.ts for independent testability.
 */

/** Resolve credentials: settings.json base, process.env override. */
export class SearchProviderCredentials {
  /** Canonical env var for each (engine, key) pair. Public for SettingsContext credential source tracking. */
  static ENV_MAP: Record<string, Record<string, string>> = {
    brave: { apiKey: "BRAVE_API_KEY" },
    tavily: { apiKey: "TAVILY_API_KEY" },
    yandex: { oauthToken: "YANDEX_OAUTH_TOKEN", folderId: "YANDEX_FOLDER_ID" },
    searxng: { url: "SEARXNG_URL" },
  };

  constructor(private readonly settings: Record<string, Record<string, string>>) {}

  /** Get a credential value. process.env wins over settings. */
  get(engine: string, key: string): string | undefined {
    const envVar = SearchProviderCredentials.ENV_MAP[engine]?.[key];
    if (envVar && process.env[envVar]) return process.env[envVar];
    return this.settings[engine]?.[key];
  }
}
