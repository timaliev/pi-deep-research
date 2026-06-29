# ADR-0004: Profile resolution from user settings

**Date:** 2026-06-27
**Status:** accepted

## Context

Profile resolution was scattered across 4 call sites with inconsistent behavior:

1. `buildParamsPrompt` read `DEFAULT_PRESETS` directly (hardcoded)
2. `buildPlanPrompt` called `resolveProfile(profile)` without user presets
3. `estimate_research_cost` called `resolveProfile(profile)` without user presets
4. `run_research` passed `settings.profiles` from `resolveSettings()`

But `resolveSettings` called `resolveSettings({})` with an empty object — user's `~/.pi/agent/settings.json` under `deepResearch.profiles` was never loaded. The `resolveSettings` function also **replaced** built-in presets entirely when user profiles were present, forcing users to copy all built-in presets to override one.

No `defaultProfile` concept existed — the fallback profile was hardcoded to `"default"`.

## Decision

**Create `ProfileResolver` as the single source of truth for profile resolution.**

`extension/profile-resolver.ts`:

- `loadDeepResearchSettings(cwd?)` — reads `deepResearch` from `~/.pi/agent/settings.json` and `<cwd>/.pi/settings.json`, merges global + project-local
- `mergeProfiles(builtin, user)` — shallow-merge per profile name; user fields override built-in, new profiles get defaults
- `ProfileResolver` class — constructor receives merged presets + `defaultProfileName`; exposes:
  - `resolve(planProfile)` — named preset or custom, falls back to `defaultProfileName`
  - `listNames()` — for prompt generation
  - `getPresets()` — for passing to `ResearchStateMachine`

**Wire into extension at load time:**

```typescript
const settings = loadDeepResearchSettings();
const profileResolver = new ProfileResolver(settings.profiles ?? {}, settings.defaultProfile);
```

All 4 call sites use `profileResolver` via closure or constructor injection (`PrefilterManager`).

**Add `defaultProfile` config key:**

- `deepResearch.defaultProfile` in settings.json (default: `"default"`)
- `buildParamsPrompt` highlights which profile is the default
- `ProfileResolver.resolve()` falls back to `defaultProfileName` when profile name not found

## Consequences

- **Locality:** One module, one interface (`resolve(name)`), one test surface
- **Leverage:** User adds `exhaustive` profile without copying built-ins; overrides `deep.breadth` without repeating other fields
- **Testability:** 12 new tests covering merge, resolve, fallback, listNames, and settings file loading
- **Deletion test passes:** Removing `ProfileResolver` forces N reimplementations of merge + resolve across 4 call sites
- Backward compatible: without `settings.json`, built-in presets work unchanged

## Replaces

- `resolveProfile()` in `state-machine.ts` (kept for backward compat, delegating to presets param)
- `DEFAULT_PRESETS` direct reads in `buildParamsPrompt`
- `resolveSettings()` in `index.ts`
