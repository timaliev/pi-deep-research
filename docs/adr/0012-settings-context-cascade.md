# ADR-0012: SettingsContext — unified settings cascade

**Date:** 2026-06-30
**Status:** accepted
**Supersedes:** ADR-0004 (in part — replaces scattered loading with single init point), ADR-0005 (in part — merges search-provider loading into cascade)

## Context

Settings loading was scattered across three code paths:

1. **`loadDeepResearchSettings()`** — read `~/.pi/agent/settings.json` + `<cwd>/.pi/settings.json`, merged `profiles`, `defaultProfile`, `artifactsDir`, `reportsDir`. No env var override.
2. **`loadSearchProviders()`** — read only `~/.pi/agent/settings.json` for API keys. No local override, no env var fallback (env was handled separately inside `SearchProviderCredentials.get()`).
3. **Index.ts inline** — hardcoded `baseDir`-relative defaults for `reportsDir`/`artifactsDir`.

These three paths used different merge strategies, different file paths, and no uniform priority chain.

## Decision

**Create `SettingsContext` — a singleton module that loads all settings once with a uniform priority cascade:**

```
env vars → <cwd>/.pi/settings.json → ~/.pi/agent/settings.json → built-in defaults
```

### Per-category cascade

| Category | Cascade |
|---|---|
| `reportsDir`, `artifactsDir`, `defaultProfile` | env → local → global → built-in |
| `profiles` | local → global → built-in (no env) |
| `searchProviders` (API keys) | env → local → global (no built-in default) |

### Interface (flat)

```typescript
interface SettingsContext {
  readonly reportsDir: string;
  readonly artifactsDir: string;
  readonly defaultProfile: string;
  readonly profiles: Record<string, ResearchProfile>;
  readonly credentials: SearchProviderCredentials;
}
```

### Lifecycle

- **Singleton** — one instance per process, immutable after construction.
- **Explicit init** — `SettingsContext.init({ cwd, homeAgentDir })` called once in `index.ts`.
- **All callers** import `{ settings }` from `settings-context.ts` — no parameter threading.

### Env var naming

| Setting | Env var |
|---|---|
| `reportsDir` | `DEEP_RESEARCH_REPORTS_DIR` |
| `artifactsDir` | `DEEP_RESEARCH_ARTIFACTS_DIR` |
| `defaultProfile` | `DEEP_RESEARCH_DEFAULT_PROFILE` |
| Brave API key | `BRAVE_API_KEY` |
| Tavily API key | `TAVILY_API_KEY` |
| Yandex OAuth | `YANDEX_OAUTH_TOKEN` |
| Yandex Folder ID | `YANDEX_FOLDER_ID` |

`profiles` is **not exposed as an env var** (complex JSON in env is too brittle).

### Relationship to existing modules

- **`ProfileResolver`** stays — receives profiles from SettingsContext, handles `resolve()` logic.
- **`SearchProviderCredentials`** stays — constructed from merged providers map inside SettingsContext.
- **`loadDeepResearchSettings()`** and **`loadSearchProviders()`** are deprecated — absorbed into SettingsContext.

## Consequences

- **Locality:** all settings loading logic in one module
- **Uniform cascade:** every setting follows the same priority chain
- **No threading:** modules import `settings` directly instead of receiving via parameters
- **Immutable:** no runtime mutation, no stale settings
- **Search providers now merge local → global** (previously global-only)
