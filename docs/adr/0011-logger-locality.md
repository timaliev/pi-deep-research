# ADR-0011: Logger locality — ResearchStateMachine owns its Research Log

**Date:** 2026-06-29
**Status:** accepted

## Context

`index.ts` created `JsonlLogger` at two call sites — initial `run_research` invocation and the reconstruction path for subsequent calls. Both call sites constructed the same log path (`logsDir/<runId>.log`). The logger was passed into `ResearchStateMachine` via `ResearchContext.logger`, making it an external dependency that callers had to know about.

Five call sites in tests passed mock loggers or `undefined`. The logger was a leak — index.ts knew where logs lived, but the state machine already had `artifactsDir` and could derive `logsDir` internally.

## Decision

**Remove `logger` from `ResearchContext`. `ResearchStateMachine` creates its own `JsonlLogger` on first `next()` call.**

Logger creation:
```typescript
if (!this.logger) {
  const logsDir = join(this.artifactsDir!, "..", "logs");
  mkdirSync(logsDir, { recursive: true });
  this.logger = new JsonlLogger(snapshot.runId, join(logsDir, `${snapshot.runId}.log`));
}
```

The logger is a mutable field (not readonly) initialized lazily — first `next()` call triggers creation. All internal `this.logger?.event(...)` calls remain safe (optional chaining retained for first call, though now always defined after it).

**`defaultArtifactsDir`** was added as a fallback function for tests that construct `ResearchStateMachine` without `artifactsDir` in `ResearchContext`.

## Consequences

- **Interface shrinks:** `ResearchContext` drops one field
- **No duplication:** one log path formula in the state machine
- **Locality:** logger lifecycle, path derivation, and event calls all in one module
- **Internal seam:** tests can observe Research Log output from `artifactsDir/../logs/`
- **index.ts** still creates a `saveLogger` for report-save events (lines 431, 455) — these happen outside the state machine's saving phase and write to the same JSONL file (appending, valid JSONL)
