# ADR: Brave engine `waitIfNeeded` error — diagnostic notes

**Date:** 2026-07-09
**Status:** Fixed (RateLimiter module + utils.ts deletion, 2026-07-09)

## Symptom

During `run_research` or `deep_web_search` with brave engine, error surfaces in output:

```
deep-research ## Errors
 - brave: Cannot read properties of undefined (reading 'waitIfNeeded')
```

This is a `TypeError` from V8 when destructuring from undefined:
`const { waitIfNeeded } = undefined`.

## Module dependency chain

```
web-search.ts
  └─ dynamic import → brave.ts
                          └─ static import → utils.ts
                                                └─ static import → web-search.ts  (circular)
```

Four other engine files (duckduckgo, tavily, yandex, searxng) use same pattern: engine → utils.ts → web-search.ts.

## Diagnosis effort

| Approach | Result |
|---|---|
| `tsx` standalone brave import | ✅ no error |
| `jiti` standalone brave import (pi's exact loader, `moduleCache: false`) | ✅ no error |
| Full `searchAllEngines` pipeline via jiti | ✅ no error |
| Full `executeResearchRound` via jiti | ✅ no error |
| Log file analysis | No error traces found |

**Error not reproducible in isolation.** Only surfaces in pi's full runtime environment.

## Hypotheses (ranked)

1. **jiti `moduleCache: false` + circular dep resolve race** — pi's jiti config disables module cache. When `web-search.ts` dynamically imports `brave.ts`, which statically imports `utils.ts`, jiti re-transpiles `web-search.ts` for the utils→web-search import. With `moduleCache: false` and fast subsequent calls, a partially-initialized module could be returned, causing the destructuring error.

2. **CJS-ESM interop** — `package.json` has no `"type": "module"`. jiti may transpile to CJS, converting `import { waitIfNeeded } from "./utils.js"` into `const { waitIfNeeded } = require("./utils.js")`. If `require` returns `undefined` for any reason → exact error.

3. **Extension reload / stale cache** — pi reloads extensions without fully clearing module state. Stale reference to disposed module.

## Proposed fix

**Remove `utils.ts` wrapper.** Have all five engine files import `waitIfNeeded` directly from `../web-search.js`:

```diff
- import { waitIfNeeded } from "./utils.js";
+ import { waitIfNeeded } from "../web-search.js";
```

Delete `extension/search/engines/utils.ts`.

**Why this fixes it:**
- Eliminates one hop in the circular chain (brave → web-search is still circular, but direct — no intermediate module that could fail)
- `web-search.ts` is always fully evaluated before any dynamic import returns, so the direct import is safe
- Removes unnecessary abstraction (utils.ts was a pure pass-through)

**Fallback if still broken:** Add `"type": "module"` to deep-research's `package.json` to force ESM transpilation in jiti.

## Files to change

- `extension/search/engines/brave.ts` — line 9
- `extension/search/engines/tavily.ts` — line 10
- `extension/search/engines/duckduckgo.ts` — line 15
- `extension/search/engines/searxng.ts` — line 9
- `extension/search/engines/yandex.ts` — line 10
- `extension/search/engines/utils.ts` — **delete**
- `tests/ddg-stagger.test.ts` — update waitIfNeeded location check (line 60-69)

## Cleanup

Debug files to remove after fix:
- `_debug_brave.ts`
- `_debug_brave.mjs`
- `_debug_full.mjs`
- `_debug_round.mjs`
