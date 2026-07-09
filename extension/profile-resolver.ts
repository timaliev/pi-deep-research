import type { ResearchPlanProfile } from "./prefilter.js";
import type { ResearchProfile } from "./state-machine.js";

/** Built-in profile presets. Owned here — not in state-machine.ts. */
export const DEFAULT_PRESETS: Record<string, ResearchProfile> = {
  default: { breadth: 4, depth: 2, concurrency: 4 },
  fast: { breadth: 2, depth: 1, concurrency: 2 },
  deep: { breadth: 6, depth: 3, concurrency: 4 },
};

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
