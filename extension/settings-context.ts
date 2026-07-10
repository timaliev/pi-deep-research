import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PRESETS, mergeProfiles } from "./profile-resolver.js";
import type { ResearchProfile } from "./state-machine.js";

/** Resolve credentials: settings.json base, process.env override. */
export class SearchProviderCredentials {
  /** Canonical env var for each (engine, key) pair. Public for SettingsContext credential source tracking. */
  static ENV_MAP: Record<string, Record<string, string>> = {
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
  settingsOnSessionStart: "DEEP_RESEARCH_SETTINGS_ON_SESSION_START",
  settingsOnRunStart: "DEEP_RESEARCH_SETTINGS_ON_RUN_START",
  settingsInReport: "DEEP_RESEARCH_SETTINGS_IN_REPORT",
} as const;

// ─── Built-in defaults ─────────────────────────────────────────
const BUILTIN = {
  defaultProfile: "default",
  profiles: DEFAULT_PRESETS,
  reportStyle: "narrative" as "narrative" | "subtopics",
  enabledEngines: ["duckduckgo", "searxng"],
  settingsReport: { onSessionStart: false, onRunStart: false, inReport: false },
};

// ─── Provenance helpers ────────────────────────────────────────
type SourceTag = string; // "default" | "env:VAR" | "file:path"

function sourceDefault(): SourceTag {
  return "default";
}

function sourceEnv(key: string): SourceTag {
  return `env:${key}`;
}

function sourceFile(absPath: string, homeDir: string): SourceTag {
  if (absPath.startsWith(homeDir)) {
    return `file:~${absPath.slice(homeDir.length)}`;
  }
  return `file:${absPath}`;
}

// ─── SettingsReport config ─────────────────────────────────────
export interface SettingsReportConfig {
  onSessionStart: boolean;
  onRunStart: boolean;
  inReport: boolean;
}

// ─── Setting entry for getAllWithSources() ─────────────────────
export interface SettingEntry {
  key: string;
  value: string | boolean;
  source: SourceTag;
}

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
  settingsReport: SettingsReportConfig;
}

export interface InitParams {
  cwd: string;
  homeAgentDir?: string;
}

// ─── Singleton ─────────────────────────────────────────────────
let instance: SettingsContext | null = null;

export class SettingsContext implements SettingsContextData {
  reportsDir!: string;
  artifactsDir!: string;
  defaultProfile!: string;
  profiles!: Record<string, ResearchProfile>;
  credentials!: SearchProviderCredentials;
  pdfExport!: boolean;
  mindMap!: boolean;
  reportStyle!: "narrative" | "subtopics";
  enabledEngines!: string[];
  settingsReport!: SettingsReportConfig;

  // ─── Provenance fields (parallel to value fields) ─────────
  reportsDirSource!: SourceTag;
  artifactsDirSource!: SourceTag;
  defaultProfileSource!: SourceTag;
  pdfExportSource!: SourceTag;
  mindMapSource!: SourceTag;
  reportStyleSource!: SourceTag;
  enabledEnginesSource!: SourceTag;
  settingsReportOnSessionStartSource!: SourceTag;
  settingsReportOnRunStartSource!: SourceTag;
  settingsReportInReportSource!: SourceTag;
  credentialSources!: Record<string, Record<string, SourceTag>>;

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
    const globalPath = join(homeAgentDir, "settings.json");
    const localPath = join(cwd, ".pi", "settings.json");
    const homeDir = homedir();

    // Read files
    const global = readJsonFile(globalPath);
    const local = readJsonFile(localPath);

    const globalDr = (global?.deepResearch ?? {}) as Record<string, unknown>;
    const localDr = (local?.deepResearch ?? {}) as Record<string, unknown>;

    // ─── String settings: env → local → global → built-in ──
    [this.reportsDir, this.reportsDirSource] = resolveString(
      ENV.reportsDir,
      localDr.reportsDir,
      globalDr.reportsDir,
      join(cwd, "deep-research", "reports"),
      localPath,
      globalPath,
      homeDir,
    );

    [this.artifactsDir, this.artifactsDirSource] = resolveString(
      ENV.artifactsDir,
      localDr.artifactsDir,
      globalDr.artifactsDir,
      join(cwd, "deep-research", "artifacts"),
      localPath,
      globalPath,
      homeDir,
    );

    [this.defaultProfile, this.defaultProfileSource] = resolveString(
      ENV.defaultProfile,
      localDr.defaultProfile,
      globalDr.defaultProfile,
      BUILTIN.defaultProfile,
      localPath,
      globalPath,
      homeDir,
    );

    // ─── Boolean settings: env → local → global → built-in ─
    [this.pdfExport, this.pdfExportSource] = resolveBool(
      ENV.pdfExport,
      localDr.pdfExport,
      globalDr.pdfExport,
      false,
      localPath,
      globalPath,
      homeDir,
    );

    [this.mindMap, this.mindMapSource] = resolveBool(
      ENV.mindMap,
      localDr.mindMap,
      globalDr.mindMap,
      false,
      localPath,
      globalPath,
      homeDir,
    );

    // ─── reportStyle ───────────────────────────────────────
    [this.reportStyle, this.reportStyleSource] = resolveReportStyleWithSource(
      envString(ENV.reportStyle),
      localDr.defaultReportStyle,
      globalDr.defaultReportStyle,
      localPath,
      globalPath,
      homeDir,
    );

    // ─── enabledEngines ────────────────────────────────────
    [this.enabledEngines, this.enabledEnginesSource] = resolveEnabledEnginesWithSource(
      envString(ENV.enabledEngines),
      localDr.enabledEngines as string[] | undefined,
      globalDr.enabledEngines as string[] | undefined,
      localPath,
      globalPath,
      homeDir,
    );

    // ─── settingsReport group ──────────────────────────────
    const localSr = localDr.settingsReport as Record<string, unknown> | undefined;
    const globalSr = globalDr.settingsReport as Record<string, unknown> | undefined;
    const srBuiltin = BUILTIN.settingsReport;

    const [srOnSession, srOnSessionSrc] = resolveBool(
      ENV.settingsOnSessionStart,
      localSr?.onSessionStart,
      globalSr?.onSessionStart,
      srBuiltin.onSessionStart,
      localPath,
      globalPath,
      homeDir,
    );

    const [srOnRun, srOnRunSrc] = resolveBool(
      ENV.settingsOnRunStart,
      localSr?.onRunStart,
      globalSr?.onRunStart,
      srBuiltin.onRunStart,
      localPath,
      globalPath,
      homeDir,
    );

    const [srInReport, srInReportSrc] = resolveBool(
      ENV.settingsInReport,
      localSr?.inReport,
      globalSr?.inReport,
      srBuiltin.inReport,
      localPath,
      globalPath,
      homeDir,
    );

    this.settingsReport = { onSessionStart: srOnSession, onRunStart: srOnRun, inReport: srInReport };
    this.settingsReportOnSessionStartSource = srOnSessionSrc;
    this.settingsReportOnRunStartSource = srOnRunSrc;
    this.settingsReportInReportSource = srInReportSrc;

    // ─── Profiles: local → global → built-in (no env) ──────
    const globalProfiles = (globalDr.profiles ?? {}) as Record<string, Partial<ResearchProfile>>;
    const localProfiles = (localDr.profiles ?? {}) as Record<string, Partial<ResearchProfile>>;
    this.profiles = mergeProfiles(mergeProfiles(BUILTIN.profiles, globalProfiles), localProfiles);

    // ─── Search providers: local → global (env handled inside cred) ─
    const globalProvidersRaw = globalDr.searchProviders as Record<string, unknown> | undefined;
    const localProvidersRaw = localDr.searchProviders as Record<string, unknown> | undefined;
    const mergedProvidersRaw = {
      ...(globalProvidersRaw ?? {}),
      ...(localProvidersRaw ?? {}),
    };
    const mergedProviders = normalizeSearchProviders(mergedProvidersRaw);
    this.credentials = new SearchProviderCredentials(mergedProviders);

    // ─── Credential sources ────────────────────────────────
    this.credentialSources = {};
    const credEnvMap = SearchProviderCredentials.ENV_MAP;
    for (const engine of Object.keys(credEnvMap)) {
      const engineCreds: Record<string, SourceTag> = {};
      for (const key of Object.keys(credEnvMap[engine])) {
        const envVar = credEnvMap[engine][key];
        if (envVar && process.env[envVar]) {
          engineCreds[key] = sourceEnv(envVar);
        } else if (typeof localProvidersRaw?.[engine] === "object" && localProvidersRaw[engine] !== null) {
          const le = localProvidersRaw[engine] as Record<string, unknown>;
          if (le[key] !== undefined) {
            engineCreds[key] = sourceFile(localPath, homeDir);
            continue;
          }
        }
        if (!engineCreds[key]) {
          if (typeof globalProvidersRaw?.[engine] === "object" && globalProvidersRaw[engine] !== null) {
            const ge = globalProvidersRaw[engine] as Record<string, unknown>;
            if (ge[key] !== undefined) {
              engineCreds[key] = sourceFile(globalPath, homeDir);
              continue;
            }
          }
        }
        if (!engineCreds[key]) {
          engineCreds[key] = sourceDefault();
        }
      }
      this.credentialSources[engine] = engineCreds;
    }
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

  /** Return all settings as a flat list of { key, value, source } entries.
   *  Excludes profiles (handled separately). Credential values are masked as "****". */
  getAllWithSources(): SettingEntry[] {
    const entries: SettingEntry[] = [
      { key: "reportsDir", value: this.reportsDir, source: this.reportsDirSource },
      { key: "artifactsDir", value: this.artifactsDir, source: this.artifactsDirSource },
      { key: "defaultProfile", value: this.defaultProfile, source: this.defaultProfileSource },
      { key: "pdfExport", value: this.pdfExport, source: this.pdfExportSource },
      { key: "mindMap", value: this.mindMap, source: this.mindMapSource },
      { key: "reportStyle", value: this.reportStyle, source: this.reportStyleSource },
      { key: "enabledEngines", value: this.enabledEngines.join(", "), source: this.enabledEnginesSource },
      {
        key: "settingsReport.onSessionStart",
        value: this.settingsReport.onSessionStart,
        source: this.settingsReportOnSessionStartSource,
      },
      {
        key: "settingsReport.onRunStart",
        value: this.settingsReport.onRunStart,
        source: this.settingsReportOnRunStartSource,
      },
      {
        key: "settingsReport.inReport",
        value: this.settingsReport.inReport,
        source: this.settingsReportInReportSource,
      },
    ];

    // Credentials with masked values
    const credEnvMap = SearchProviderCredentials.ENV_MAP;
    for (const engine of Object.keys(credEnvMap)) {
      for (const key of Object.keys(credEnvMap[engine])) {
        const src = this.credentialSources[engine]?.[key] ?? sourceDefault();
        entries.push({
          key: `${engine}.${key}`,
          value: "****",
          source: src,
        });
      }
    }

    return entries;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/** Resolve string with provenance. */
function resolveString(
  envKey: string,
  localVal: unknown,
  globalVal: unknown,
  defaultVal: string,
  localPath: string,
  globalPath: string,
  homeDir: string,
): [string, SourceTag] {
  const env = envString(envKey);
  if (env !== undefined) return [env, sourceEnv(envKey)];
  if (typeof localVal === "string" && localVal.length > 0) return [localVal, sourceFile(localPath, homeDir)];
  if (typeof globalVal === "string" && globalVal.length > 0) return [globalVal, sourceFile(globalPath, homeDir)];
  return [defaultVal, sourceDefault()];
}

/** Resolve boolean with provenance. */
function resolveBool(
  envKey: string,
  localVal: unknown,
  globalVal: unknown,
  defaultVal: boolean,
  localPath: string,
  globalPath: string,
  homeDir: string,
): [boolean, SourceTag] {
  const env = envBool(envKey);
  if (env !== undefined) return [env, sourceEnv(envKey)];
  if (typeof localVal === "boolean") return [localVal, sourceFile(localPath, homeDir)];
  if (typeof globalVal === "boolean") return [globalVal, sourceFile(globalPath, homeDir)];
  return [defaultVal, sourceDefault()];
}

/** Resolve report style with provenance. */
function resolveReportStyleWithSource(
  env: string | undefined,
  local: unknown,
  global: unknown,
  localPath: string,
  globalPath: string,
  homeDir: string,
): ["narrative" | "subtopics", SourceTag] {
  const valid = ["narrative", "subtopics"];
  if (env && valid.includes(env)) return [env as "narrative" | "subtopics", sourceEnv(ENV.reportStyle)];
  if (typeof local === "string" && valid.includes(local))
    return [local as "narrative" | "subtopics", sourceFile(localPath, homeDir)];
  if (typeof global === "string" && valid.includes(global))
    return [global as "narrative" | "subtopics", sourceFile(globalPath, homeDir)];
  return [BUILTIN.reportStyle, sourceDefault()];
}

/** Resolve enabled engines with provenance. */
function resolveEnabledEnginesWithSource(
  env: string | undefined,
  local: string[] | undefined,
  global: string[] | undefined,
  localPath: string,
  globalPath: string,
  homeDir: string,
): [string[], SourceTag] {
  if (env && env.length > 0)
    return [
      env
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      sourceEnv(ENV.enabledEngines),
    ];
  if (local && local.length > 0) return [local, sourceFile(localPath, homeDir)];
  if (global && global.length > 0) return [global, sourceFile(globalPath, homeDir)];
  return [BUILTIN.enabledEngines, sourceDefault()];
}

function normalizeSearchProviders(raw: unknown): Record<string, Record<string, string>> {
  if (!raw || typeof raw !== "object") return {};

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
