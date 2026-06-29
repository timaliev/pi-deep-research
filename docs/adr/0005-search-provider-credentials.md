# ADR-0005: Search provider credentials from settings.json

**Date:** 2026-06-29
**Status:** accepted

## Context

Search engine API keys were read exclusively from `process.env` in two files:

- `prefilter.ts` (`checkApiKeys`) — validates credentials before prefilter search
- `search/web-search.ts` (`searchBrave`, `searchTavily`, `searchYandex`) — reads keys at call time

Users had no way to configure keys in `settings.json`. Every key required an environment variable. This creates friction for users who prefer a single configuration file.

## Decision

**Create `SearchProviderCredentials` module (`extension/search-providers.ts`).**

- `loadSearchProviders(settingsPath)` — reads `deepResearch.searchProviders` from settings.json. Returns per-engine credential records (e.g., `{ brave: { apiKey: "..." }, yandex: { oauthToken: "...", folderId: "..." } }`).
- `SearchProviderCredentials` class — resolves credentials with env override:
  - `get(engine, key)` — checks canonical `process.env` var first (via `ENV_MAP`), falls back to settings
  - `has(engine, requiredKeys)` — returns missing keys for validation

**Precedence: process.env wins over settings.json.** Security best practice — secrets in environment take priority over file-based config.

**Wire into prefilter:** `PrefilterManager` accepts optional `SearchProviderCredentials`. `checkApiKeys` uses `cred.get()` with fallback to `process.env`.

**Wire at extension load:** `loadSearchProviders()` called at startup from `~/.pi/agent/settings.json`. Passed to `PrefilterManager`.

**Settings structure:**

```json
{
  "deepResearch": {
    "searchProviders": {
      "brave": { "apiKey": "BSA..." },
      "tavily": { "apiKey": "tvly-..." },
      "yandex": { "oauthToken": "...", "folderId": "..." }
    }
  }
}
```

## Consequences

- **Locality:** One module for all credential resolution
- **Leverage:** Used by prefilter check + future search function injection (Candidate 2)
- **Testability:** 11 tests — load, get, has, env override, integration with checkApiKeys
- **Follows ProfileResolver precedent (ADR-0004):** settings.json → merged → single interface
- **Backward compatible:** without settings.json, process.env works unchanged
