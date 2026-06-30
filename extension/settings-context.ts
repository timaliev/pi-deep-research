import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_PRESETS } from "./profile-resolver.js";
import type { ResearchProfile } from "./state-machine.js";
import { mergeProfiles } from "./profile-resolver.js";
import { SearchProviderCredentials } from "./search-providers.js";
import type { ResearchPlanProfile } from "./prefilter.js";

// ─── Env var names ─────────────────────────────────────────────
const ENV = {
  reportsDir: "DEEP_RESEARCH_REPORTS_DIR",
  artifactsDir: "DEEP_RESEARCH_ARTIFACTS_DIR",
  defaultProfile: "DEEP_RESEARCH_DEFAULT_PROFILE",
} as const;

// ─── Built-in defaults ─────────────────────────────────────────
const BUILTIN = {
  defaultProfile: "default",
  profiles: DEFAULT_PRESETS,
};

// ─── Interface ─────────────────────────────────────────────────
export interface SettingsContextData {
  reportsDir: string;
  artifactsDir: string;
  defaultProfile: string;
  profiles: Record<string, ResearchProfile>;
  credentials: SearchProviderCredentials;
}

export interface InitParams {
  cwd: string;
  homeAgentDir?: string;
}

// ─── Singleton ─────────────────────────────────────────────────
let instance: SettingsContext | null = null;

export class SettingsContext implements SettingsContextData {
  readonly reportsDir: string;
  readonly artifactsDir: string;
  readonly defaultProfile: string;
  readonly profiles: Record<string, ResearchProfile>;
  readonly credentials: SearchProviderCredentials;

  private constructor(params: InitParams) {
    const homeAgentDir = params.homeAgentDir ?? join(homedir(), ".pi", "agent");

    // Read files
    const global = readJsonFile(join(homeAgentDir, "settings.json"));
    const local = readJsonFile(join(params.cwd, ".pi", "settings.json"));

    const globalDr = (global?.deepResearch ?? {}) as Record<string, unknown>;
    const localDr = (local?.deepResearch ?? {}) as Record<string, unknown>;

    // ─── String settings: env → local → global → built-in ────
    this.reportsDir = envString(ENV.reportsDir)
      ?? (localDr.reportsDir as string | undefined)
      ?? (globalDr.reportsDir as string | undefined)
      ?? join(params.cwd, "deep-research", "reports");

    this.artifactsDir = envString(ENV.artifactsDir)
      ?? (localDr.artifactsDir as string | undefined)
      ?? (globalDr.artifactsDir as string | undefined)
      ?? join(params.cwd, "deep-research", "artifacts");

    this.defaultProfile = envString(ENV.defaultProfile)
      ?? (localDr.defaultProfile as string | undefined)
      ?? (globalDr.defaultProfile as string | undefined)
      ?? BUILTIN.defaultProfile;

    // ─── Profiles: local → global → built-in (no env) ────────
    const globalProfiles = (globalDr.profiles ?? {}) as Record<string, Partial<ResearchProfile>>;
    const localProfiles = (localDr.profiles ?? {}) as Record<string, Partial<ResearchProfile>>;
    this.profiles = mergeProfiles(
      mergeProfiles(BUILTIN.profiles, globalProfiles),
      localProfiles,
    );

    // ─── Search providers: local → global (env handled inside cred) ──
    const globalProviders = (globalDr.searchProviders ?? {}) as Record<string, Record<string, string>>;
    const localProviders = (localDr.searchProviders ?? {}) as Record<string, Record<string, string>>;
    const mergedProviders = { ...globalProviders, ...localProviders };
    this.credentials = new SearchProviderCredentials(mergedProviders);
  }

  /** Initialize the singleton. Subsequent calls return the same instance. */
  static init(params: InitParams): SettingsContext {
    if (!instance) instance = new SettingsContext(params);
    return instance;
  }

  /** @internal Reset singleton — for testing only. */
  static _reset(): void {
    instance = null;
  }

  /** Get the current instance (throws if not initialized). */
  static get(): SettingsContext {
    if (!instance) throw new Error("SettingsContext not initialized. Call SettingsContext.init() first.");
    return instance;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function envString(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}
