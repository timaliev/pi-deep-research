import { existsSync, readFileSync } from "node:fs";

/** Per-engine credential keys loaded from settings.json */
type ProviderCredentials = Record<string, Record<string, string>>;

/** Read searchProviders from a settings.json file. */
export function loadSearchProviders(settingsPath: string): ProviderCredentials {
  try {
    if (!existsSync(settingsPath)) return {};
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    return (raw?.deepResearch?.searchProviders ?? {}) as ProviderCredentials;
  } catch {
    return {};
  }
}

/** Resolve credentials: settings.json base, process.env override. */
export class SearchProviderCredentials {
  /** Canonical env var for each (engine, key) pair. */
  private static ENV_MAP: Record<string, Record<string, string>> = {
    brave: { apiKey: "BRAVE_API_KEY" },
    tavily: { apiKey: "TAVILY_API_KEY" },
    yandex: { oauthToken: "YANDEX_OAUTH_TOKEN", folderId: "YANDEX_FOLDER_ID" },
  };

  constructor(private readonly settings: ProviderCredentials) {}

  /** Get a credential value. process.env wins over settings. */
  get(engine: string, key: string): string | undefined {
    const envVar = SearchProviderCredentials.ENV_MAP[engine]?.[key];
    if (envVar && process.env[envVar]) return process.env[envVar];
    return this.settings[engine]?.[key];
  }

  /** Returns array of required keys that are missing (neither env nor settings). */
  has(engine: string, requiredKeys: string[]): string[] {
    return requiredKeys.filter((k) => !this.settings[engine]?.[k]);
  }
}
