# ADR-0009: Engine adapters — per-engine search modules

**Date:** 2026-06-29
**Status:** accepted

## Context

`web-search.ts` was an 850-line module containing five search engine implementations (DDG, Brave, Tavily, Yandex, SearXNG), shared HTTP utilities, rate-limiting, HTML parsing, XML parsing, IAM token flow, and two dispatchers (`searchWeb`, `multiEngineWebSearch`). Adding a new engine or modifying an existing one required navigating this single file.

## Decision

**Extract each engine into a dedicated adapter module under `search/engines/` behind a common `EngineSearchFn` type signature.**

```
search/
├── engines/
│   ├── duckduckgo.ts
│   ├── brave.ts
│   ├── tavily.ts
│   ├── yandex.ts
│   ├── searxng.ts
│   └── utils.ts
└── web-search.ts  (factory + dispatchers)
```

Each adapter exports a `search(query, opts, cred?)` function matching:

```typescript
type EngineSearchFn = (
  query: string,
  opts: WebSearchOptions,
  cred?: SearchProviderCredentials,
) => Promise<WebSearchResult[]>;
```

**Factory:** `createEngineSearchFn(engine: SearchEngine): EngineSearchFn` uses lazy dynamic imports via an `ENGINE_LOADERS` map. Unknown engines return a no-op (empty array).

**Dispatchers** (`searchWeb`, `multiEngineWebSearch`) build an `engineFns` map dynamically via `createEngineSearchFn` instead of a hardcoded inline object. The existing engine implementation functions (`searchDuckDuckGo`, `searchBrave`, etc.) remain in `web-search.ts` as canonical implementations; adapters re-export and wrap them.

## Consequences

- **Isolation:** engine changes touch only one adapter file
- **Add engine:** create adapter + add entry to `ENGINE_LOADERS`
- **No circular deps:** adapters import from `web-search.ts`, factory dispatches to adapters via dynamic import
- **Backward-compat:** `searchWeb` and `multiEngineWebSearch` signatures unchanged
- **web-search.ts** still contains engine implementations (~830→lines) — full extraction of implementation logic deferred
