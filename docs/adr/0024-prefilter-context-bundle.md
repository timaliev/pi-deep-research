# ADR-0024: PrefilterContext — bundled constructor for PrefilterManager

**Date:** 2026-07-15
**Status:** proposed

## Context

ADR-0007 introduced `ResearchContext` to bundle `ResearchStateMachine`'s 6 constructor params into a single typed object. It explicitly deferred PrefilterManager:

> *"PrefilterManager is kept with positional params for now — its constructor is called in fewer places (2: index.ts + tests) and the pattern is well-understood. Can be refactored in a follow-up."*

Since then, PrefilterManager's constructor has grown to **10 positional parameters**, 5 of them optional:

```typescript
constructor(
  searchFn: typeof SearchWebFn,       // required
  scraper: Scraper,                    // required
  artifactsDir: string,                // required
  logger?: Logger,                     // optional
  profileResolver?: ProfileResolver,   // optional
  searchCred?: SearchProviderCredentials, // optional
  sharedRunId?: string,                // optional
  defaultReportStyle?: "narrative" | "subtopics", // optional
  enabledEngines?: string[],           // optional
)
```

The sole construction site (`PrefilterSession.getOrCreate()`) already holds all 9 dependencies — it just spreads them across positional slots. Adding a new dependency requires touching the constructor signature, the construction site, and any test files that construct a PrefilterManager.

## Decision

**Apply the ResearchContext pattern to PrefilterManager.**

Introduce a `PrefilterContext` interface:

```typescript
interface PrefilterContext {
  searchFn: typeof SearchWebFn;
  scraper: Scraper;
  artifactsDir: string;
  logger?: Logger;
  profileResolver?: ProfileResolver;
  searchCred?: SearchProviderCredentials;
  sharedRunId?: string;
  defaultReportStyle?: "narrative" | "subtopics";
  enabledEngines?: string[];
}
```

Constructor takes one parameter: `constructor(ctx: PrefilterContext)`.

Construction site changes from:
```typescript
new PrefilterManager(searchFn, scraper, artifactsDir, logger, profileResolver, searchCred, runId, reportStyle, engines)
```
To:
```typescript
new PrefilterManager({ searchFn, scraper, artifactsDir, logger, profileResolver, searchCred, sharedRunId: runId, defaultReportStyle: reportStyle, enabledEngines: engines })
```

## Consequences

- **Interface shrinks:** 1 param instead of 10
- **Locality:** adding a dependency changes the context interface + single construction site
- **Named fields:** optionality self-documenting — no skipped `undefined` placeholders
- **Consistency:** same pattern as `ResearchContext` (ADR-0007), `OrchestratorDeps` (ADR-0016)
- **Tests:** `PrefilterContext` can be constructed with only required fields (`searchFn`, `scraper`, `artifactsDir`)
