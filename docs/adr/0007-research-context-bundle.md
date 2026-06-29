# ADR-0007: ResearchContext — bundled constructor for state machine and prefilter

**Date:** 2026-06-29
**Status:** accepted

## Context

`ResearchStateMachine` constructor had 6 positional parameters, 4 optional:

```typescript
constructor(
  searchFn,      // required
  scraper,       // required
  profilePresets,// optional
  logger,        // optional
  artifactsDir,  // optional
  searchCred,    // optional
)
```

Adding a new dependency (e.g., `searchCred` in a recent fix) required touching all 23 call sites across `index.ts` and 10 test files. The same pattern existed in `PrefilterManager` (6 params: `searchFn, scraper, artifactsDir, logger, profileResolver, searchCred`).

## Decision

**Bundle optional constructor dependencies into a single context object.**

`ResearchContext` interface:

```typescript
interface ResearchContext {
  searchFn: typeof SearchWebFn;
  scraper: Scraper;
  profilePresets?: Record<string, ResearchProfile>;
  logger?: Logger;
  artifactsDir?: string;
  searchCred?: SearchProviderCredentials;
}
```

Constructor takes one parameter: `constructor(ctx: ResearchContext)`.

Call sites change from:
```typescript
new ResearchStateMachine(searchWeb, scraper, presets, logger, dir, cred)
```
To:
```typescript
new ResearchStateMachine({ searchFn: searchWeb, scraper, profilePresets: presets, logger, artifactsDir: dir, searchCred: cred })
```

**PrefilterManager** is kept with positional params for now — its constructor is called in fewer places (2: index.ts + tests) and the pattern is well-understood. Can be refactored in a follow-up.

**`SessionState` module** (`extension/session-state.ts`) was also created to consolidate persistence key constants and draftReport restore logic. It is tested but not yet wired into `index.ts` — the wiring is deferred to avoid an overly invasive refactor in one pass.

## Consequences

- **Interface shrinks:** 1 param instead of 6
- **Locality:** adding a new dependency changes the context interface + single call site, not 23
- **Named fields:** optionality self-documenting, no skipped `undefined` placeholders
- **Testable:** `ResearchContext` can be constructed with only required fields in tests
- **183 tests pass** after refactoring all call sites
