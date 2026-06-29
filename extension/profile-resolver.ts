import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_PRESETS } from "./state-machine.js";
import type { ResearchProfile } from "./state-machine.js";
import type { ResearchPlanProfile } from "./prefilter.js";

/** Shape of deepResearch section in settings.json. */
export interface DeepResearchSettings {
  profiles?: Record<string, Partial<ResearchProfile> & { breadth?: number; depth?: number; concurrency?: number; maxSearchCalls?: number; maxElapsedSeconds?: number }>;
  defaultProfile?: string;
  artifactsDir?: string;
  reportsDir?: string;
}

const HOME_AGENT_DIR = join(homedir(), ".pi", "agent");
const CWD_PI_DIR = ".pi";

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Load deepResearch settings, merging global + project-local. */
export function loadDeepResearchSettings(cwd?: string, agentDir?: string): DeepResearchSettings {
  const homeAgentDir = agentDir ?? HOME_AGENT_DIR;
  const global = readJsonFile(join(homeAgentDir, "settings.json"));
  const local = cwd ? readJsonFile(join(cwd, CWD_PI_DIR, "settings.json")) : null;

  const globalDr = (global?.deepResearch ?? {}) as DeepResearchSettings;
  const localDr = (local?.deepResearch ?? {}) as DeepResearchSettings;

  return {
    profiles: { ...globalDr.profiles, ...localDr.profiles },
    defaultProfile: localDr.defaultProfile ?? globalDr.defaultProfile,
    artifactsDir: localDr.artifactsDir ?? globalDr.artifactsDir,
    reportsDir: localDr.reportsDir ?? globalDr.reportsDir,
  };
}

/** Shallow-merge user profile overrides into built-in presets. */
export function mergeProfiles(
  builtin: Record<string, ResearchProfile>,
  user: Record<string, Partial<ResearchProfile> & { breadth?: number; depth?: number; concurrency?: number }>,
): Record<string, ResearchProfile> {
  const merged: Record<string, ResearchProfile> = { ...builtin };
  for (const [name, override] of Object.entries(user)) {
    const base = builtin[name];
    if (base) {
      // Shallow-merge: user fields override built-in fields
      merged[name] = { ...base, ...override };
    } else {
      // New profile: fill missing fields from defaults
      merged[name] = {
        breadth: override.breadth ?? 4,
        depth: override.depth ?? 2,
        concurrency: override.concurrency ?? 4,
        maxSearchCalls: override.maxSearchCalls,
        maxElapsedSeconds: override.maxElapsedSeconds,
      };
    }
  }
  return merged;
}

/** Unified profile resolver — single source of truth for profile resolution. */
export class ProfileResolver {
  private readonly presets: Record<string, ResearchProfile>;
  readonly defaultProfileName: string;

  constructor(
    userProfiles: Record<string, Partial<ResearchProfile>>,
    defaultProfileName?: string,
    builtinPresets?: Record<string, ResearchProfile>,
  ) {
    const builtin = builtinPresets ?? DEFAULT_PRESETS;
    this.presets = mergeProfiles(builtin, userProfiles);
    this.defaultProfileName = defaultProfileName ?? "default";
  }

  /** Resolve a ResearchPlanProfile to a concrete ResearchProfile. */
  resolve(planProfile: ResearchPlanProfile): ResearchProfile {
    if (planProfile.name !== "custom") {
      return this.presets[planProfile.name] ?? this.presets[this.defaultProfileName] ?? this.presets.default;
    }
    // Custom: merge plan numbers with the custom preset defaults
    const customPreset = this.presets.custom;
    return {
      breadth: planProfile.breadth ?? customPreset?.breadth ?? 4,
      depth: planProfile.depth ?? customPreset?.depth ?? 2,
      concurrency: planProfile.concurrency ?? customPreset?.concurrency ?? 4,
      maxSearchCalls: customPreset?.maxSearchCalls,
      maxElapsedSeconds: customPreset?.maxElapsedSeconds,
    };
  }

  /** List all merged profile names (for prompts). */
  listNames(): string[] {
    return Object.keys(this.presets);
  }

  /** Get the presets record (for passing to ResearchStateMachine). */
  getPresets(): Record<string, ResearchProfile> {
    return this.presets;
  }
}
