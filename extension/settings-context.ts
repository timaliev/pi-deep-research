import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResearchPlanProfile } from "./prefilter.js";
import { DEFAULT_PRESETS, mergeProfiles } from "./profile-resolver.js";
import type { ResearchProfile } from "./state-machine.js";

/** Resolve credentials: settings.json base, process.env override. */
export class SearchProviderCredentials {
  /** Canonical env var for each (engine, key) pair. */
  private static ENV_MAP: Record<string, Record<string, string>> = {
    brave: { apiKey: "BRAVE_API_KEY" },
    tavily: { apiKey: "TAVILY_API_KEY" },
    yandex: { oauthToken: "YANDEX_OAUTH_TOKEN", folderId: "YANDEX_FOLDER_ID" },
  };

  constructor(private readonly settings: Record<string, Record<string, string>>) {}

  /** Get a credential value. process.env wins over settings. */
  get(engine: string, key: string): string | undefined {
    const envVar = SearchProviderCredentials.ENV_MAP[engine]?.[key];
    if (envVar && process.env[envVar]) return process.env[envVar];
    return this.settings[engine]?.[key];
  }
}

// ─── Env var names ─────────────────────────────────────────────
const ENV = {
  reportsDir: "DEEP_RESEARCH_REPORTS_DIR",
  artifactsDir: "DEEP_RESEARCH_ARTIFACTS_DIR",
  defaultProfile: "DEEP_RESEARCH_DEFAULT_PROFILE",
  pdfExport: "DEEP_RESEARCH_PDF_EXPORT",
  mindMap: "DEEP_RESEARCH_MIND_MAP",
  reportStyle: "DEEP_RESEARCH_REPORT_STYLE",
  enabledEngines: "DEEP_RESEARCH_ENABLED_ENGINES",
} as const;

// ─── Built-in defaults ─────────────────────────────────────────
const BUILTIN = {
  defaultProfile: "default",
  profiles: DEFAULT_PRESETS,
  reportStyle: "narrative" as "narrative" | "subtopics",
  enabledEngines: ["duckduckgo", "searxng"],
};

// ─── Interface ─────────────────────────────────────────────────
export interface SettingsContextData {
  reportsDir: string;
  artifactsDir: string;
  defaultProfile: string;
  profiles: Record<string, ResearchProfile>;
  credentials: SearchProviderCredentials;
  pdfExport: boolean;
  mindMap: boolean;
  reportStyle: "narrative" | "subtopics";
  enabledEngines: string[];
}

export interface InitParams {
  cwd: string;
  homeAgentDir?: string;
}

// ─── Singleton ─────────────────────────────────────────────────
let instance: SettingsContext | null = null;

export class SettingsContext implements SettingsContextData {
  reportsDir: string;
  artifactsDir: string;
  defaultProfile: string;
  profiles: Record<string, ResearchProfile>;
  credentials: SearchProviderCredentials;
  pdfExport: boolean;
  mindMap: boolean;
  reportStyle: "narrative" | "subtopics";
  enabledEngines: string[];

  private homeAgentDir: string;

  private constructor(params: InitParams) {
    this.homeAgentDir = params.homeAgentDir ?? join(homedir(), ".pi", "agent");
    this.compute(params.cwd);
  }

  /** Re-apply settings cascade with a new working directory (ADR-0020). */
  reinit(cwd: string): void {
    this.compute(cwd);
  }

  private compute(cwd: string): void {
    const homeAgentDir = this.homeAgentDir;

    // Read files
    const global = readJsonFile(join(homeAgentDir, "settings.json"));
    const local = readJsonFile(join(cwd, ".pi", "settings.json"));

    const globalDr = (global?.deepResearch ?? {}) as Record<string, unknown>;
    const localDr = (local?.deepResearch ?? {}) as Record<string, unknown>;

    // ─── String settings: env → local → global → built-in ────
    this.reportsDir =
      envString(ENV.reportsDir) ??
      (localDr.reportsDir as string | undefined) ??
      (globalDr.reportsDir as string | undefined) ??
      join(cwd, "deep-research", "reports");

    this.artifactsDir =
      envString(ENV.artifactsDir) ??
      (localDr.artifactsDir as string | undefined) ??
      (globalDr.artifactsDir as string | undefined) ??
      join(cwd, "deep-research", "artifacts");

    this.defaultProfile =
      envString(ENV.defaultProfile) ??
      (localDr.defaultProfile as string | undefined) ??
      (globalDr.defaultProfile as string | undefined) ??
      BUILTIN.defaultProfile;

    // ─── pdfExport: env → local → global → built-in false ──
    this.pdfExport =
      envBool(ENV.pdfExport) ??
      (localDr.pdfExport as boolean | undefined) ??
      (globalDr.pdfExport as boolean | undefined) ??
      false;

    // ─── mindMap: env → local → global → built-in false ─────
    this.mindMap =
      envBool(ENV.mindMap) ??
      (localDr.mindMap as boolean | undefined) ??
      (globalDr.mindMap as boolean | undefined) ??
      false;

    // ─── reportStyle: env → local → global → built-in narrative ──
    this.reportStyle = resolveReportStyle(
      envString(ENV.reportStyle),
      localDr.defaultReportStyle as string | undefined,
      globalDr.defaultReportStyle as string | undefined,
    );

    // ─── enabledEngines: env → local → global → built-in ────
    this.enabledEngines = resolveEnabledEngines(
      envString(ENV.enabledEngines),
      localDr.enabledEngines as string[] | undefined,
      globalDr.enabledEngines as string[] | undefined,
    );

    // ─── Profiles: local → global → built-in (no env) ────────
    const globalProfiles = (globalDr.profiles ?? {}) as Record<string, Partial<ResearchProfile>>;
    const localProfiles = (localDr.profiles ?? {}) as Record<string, Partial<ResearchProfile>>;
    this.profiles = mergeProfiles(mergeProfiles(BUILTIN.profiles, globalProfiles), localProfiles);

    // ─── Search providers: local → global (env handled inside cred) ──
    const globalProvidersRaw = globalDr.searchProviders;
    const localProvidersRaw = localDr.searchProviders;
    // Merge raw, then normalize — handles array format and field casing
    const mergedProvidersRaw = {
      ...((globalProvidersRaw as Record<string, unknown>) ?? {}),
      ...((localProvidersRaw as Record<string, unknown>) ?? {}),
    };
    const mergedProviders = normalizeSearchProviders(mergedProvidersRaw);
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

/** Resolve report style: env → local → global → "narrative". Invalid values fall back to "narrative". */
function resolveReportStyle(env?: string, local?: string, global?: string): "narrative" | "subtopics" {
  const valid = ["narrative", "subtopics"];
  const value = env ?? local ?? global;
  if (value && valid.includes(value)) return value as "narrative" | "subtopics";
  return "narrative";
}

/** Resolve enabled engines: env (comma-separated) → local → global → built-in default. */
function resolveEnabledEngines(
  env?: string,
  local?: string[],
  global?: string[],
): string[] {
  if (env && env.length > 0) return env.split(",").map((s) => s.trim()).filter(Boolean);
  if (local && local.length > 0) return local;
  if (global && global.length > 0) return global;
  return BUILTIN.enabledEngines;
}

/** Normalize searchProviders from settings.json into the canonical
 *  Record&lt;engine, Record&lt;key, value&gt;&gt; shape expected by SearchProviderCredentials.
 *
 *  Handles two common format mismatches silently:
 *  1. Array format  [{name: "brave", apikey: "..."}]  →  {brave: {apiKey: "..."}}
 *  2. Case mismatch  apikey → apiKey, oauth_token → oauthToken
 *
 *  Already-correct input passes through unchanged. */
function normalizeSearchProviders(raw: unknown): Record<string, Record<string, string>> {
  if (!raw || typeof raw !== "object") return {};

  // Field name normalisation map (lowercase → canonical camelCase)
  const KEY_MAP: Record<string, string> = {
    apikey: "apiKey",
    oauth_token: "oauthToken",
    oauthtoken: "oauthToken",
    folder_id: "folderId",
    folderid: "folderId",
  };

  const normalizeFields = (fields: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== "string") continue;
      const canonical = KEY_MAP[key.toLowerCase()] ?? key;
      out[canonical] = value;
    }
    return out;
  };

  // Array format: [{name: "brave", apikey: "..."}, ...]
  if (Array.isArray(raw)) {
    const result: Record<string, Record<string, string>> = {};
    for (const item of raw as Array<Record<string, unknown>>) {
      const name = item?.name;
      if (typeof name !== "string" || name.length === 0) continue;
      const { name: _, ...fields } = item;
      result[name] = normalizeFields(fields);
    }
    return result;
  }

  // Object format: {brave: {apiKey: "..."}, tavily: {apiKey: "..."}}
  const result: Record<string, Record<string, string>> = {};
  for (const [engine, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields || typeof fields !== "object") continue;
    result[engine] = normalizeFields(fields as Record<string, unknown>);
  }
  return result;
}

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

function envBool(key: string): boolean | undefined {
  const v = process.env[key];
  if (!v || v.length === 0) return undefined;
  return v === "true" || v === "1";
}
