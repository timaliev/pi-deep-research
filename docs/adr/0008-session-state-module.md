# ADR-0008: SessionState — unified persistence seam

**Date:** 2026-06-29
**Status:** accepted

## Context

Session persistence was scattered across `extension/index.ts`:
- Three string constants (`STATE_KEY`, `REPORT_PATH_KEY`, `CONFIRMATION_KEY`)
- Five `pi.appendEntry(...)` call sites with inline data shaping
- DraftReport restore logic duplicated in `run_research` handler (check `draftReady`, call `extractTextContent`, guard on length ≥ 40)
- No single point of change for session data format

Adding a new persisted field required touching both write and restore paths in `index.ts`.

## Decision

**Create `SessionState` module (`extension/session-state.ts`) as the single seam for all session persistence.**

Exposes `EntryWriter` interface:

```typescript
interface EntryWriter {
  appendEntry(customType: string, data?: unknown): void;
}
```

`SessionState` constructor takes an `EntryWriter` (passed `pi.appendEntry.bind(pi)` in index.ts). Typed methods:

| Method | Key | Data |
|---|---|---|
| `saveResearchState(snapshot, extra)` | `deep-research:state` | Snapshot without `draftReport`, adds `draftReady` + `draftLength` |
| `saveReportPath(path, dir, telemetry)` | `deep-research:report-path` | Path, dir, telemetry |
| `saveConfirmation(path)` | `deep-research:plan-confirmed` | Plan artifact path |
| `restoreDraft(stateData, agentResponse?)` | — | Re-extracts draft from agent response if `draftReady` flag is set |

**Wire into index.ts:** All three key constants removed, all `pi.appendEntry(...)` calls replaced with `session.*` methods, draft restore logic collapsed to `session.restoreDraft(...)`.

## Consequences

- **Single seam:** all persistence format changes in one file
- **Testable:** `EntryWriter` injected in tests via simple mock
- **index.ts shrinks:** ~15 lines removed, no key constants, no draft extraction
- **Backward-compat:** reads old entries by string key lookup unchanged
