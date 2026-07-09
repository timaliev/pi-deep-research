# ADR-0015: ResearchDraft module — collapse triple-path draft handling

**Date:** 2026-07-09
**Status:** accepted ✓ (implemented 2026-07-09)

## Context

The draft report — the final markdown output of a Research Run — flows through four modules across two persistence boundaries:

1. **`doDrafting`** (state-machine.ts) — captures agent response into `snapshot.draftReport: string`
2. **`doSaving`** (state-machine.ts) — checks `draftReport.length >= 40`; if too short, falls back to `parsedResponse` (second extraction from agent text)
3. **`SessionState.saveState`** (session-state.ts) — strips `draftReport` (avoiding large session entries), stores `draftReady: boolean` and `draftLength: number` as proxies
4. **`ResearchRunOrchestrator.handleSubsequentCall`** (research-run-orchestrator.ts) — re-extracts draft text from agent conversation history when restoring state, setting `snapshot.draftReport` from `parsedResponse`

This triple-path handling creates a fragility surface: the draft can be lost if agent text parsing fails, if the session entry is missing, or if the encoding/decoding proxies are inconsistent.

**Documented bug:** The orchestrator's re-extraction at `orchestrator.ts:138` only fires when `snapshot.phase === "drafting"`. If a session restarts while the state machine is in `"saving"` phase, the draft is **not restored** — `doSaving` must rely on its own `parsedResponse` fallback (the same agent text that already failed once). This phase-gating is the root cause of the "stuck in saving" production bug: the orchestrator skips draft restore for `"saving"` phase, and `doSaving`'s fallback also fails because the agent text was already consumed.

A production bug was observed where the state machine remained stuck in the `saving` phase — `doSaving` received an empty `draftReport`, the fallback `parsedResponse` was also empty, and the blocking condition prevented advancing to `done`.

The root cause is architectural: no single module owns the draft lifecycle.

## Decision

Introduce a **`ResearchDraft`** module that owns the complete draft lifecycle behind a single interface.

### Module interface

```typescript
class ResearchDraft {
  private text: string;          // raw markdown

  set(text: string): void;       // overwrite draft
  get(): string;                 // read draft
  isReady(): boolean;            // text.length >= 40 (same threshold as today)

  encode(): string | undefined;  // zlib.deflateSync → base64url, only if isReady()
  static decode(encoded: string): ResearchDraft;  // base64url → zlib.inflateSync
}
```

### Encoding

Uses **Node.js built-in `zlib.deflateSync` / `inflateSync`** (no new npm dependencies). Compression is base64url-encoded for safe embedding in JSON session entries.

- Empty/unready draft → `encode()` returns `undefined` — nothing persisted
- Ready draft → compressed + base64url → stored as `draftEncoded` in session entry
- 30KB report → ~7.5KB deflated → ~10KB base64url — well within session entry size tolerance (previous defensive strip was not driven by a hard limit)

### Ownership

`ResearchDraft` is a field on `ResearchSnapshot`, replacing `draftReport: string`. The state machine creates it on init (`new ResearchDraft()`). The orchestrator accesses it via `snapshot.draft`. `SessionState` encodes/decodes at the persistence boundary.

### Serialization boundary

`saveState` extracts the encoded draft before omitting the draft object:

```typescript
// Current:
const { draftReport: _dr, ...safe } = snapshot;
this.writer.appendEntry(STATE_KEY, {
  ...safe,
  draftReady: (snapshot.draftReport?.length ?? 0) >= 40,
  draftLength: snapshot.draftReport?.length ?? 0,
  ...extra,
});

// Proposed:
const draftEncoded = snapshot.draft?.encode();
const { draft: _d, ...safe } = snapshot;
this.writer.appendEntry(STATE_KEY, {
  ...safe,
  draftEncoded,  // string | undefined — stored, draft object omitted
  ...extra,
});
```

### Deserialization boundary

The orchestrator reconstructs the draft object from the encoded blob on session restore:

```typescript
// Current:
if (snapshot.phase === "drafting") {
  const draftReady = stateData.draftReady as boolean | undefined;
  if (draftReady && parsedResponse && parsedResponse.length >= 40) {
    snapshot.draftReport = parsedResponse;  // fragile re-extraction
  }
}

// Proposed:
const draftEncoded = stateData.draftEncoded as string | undefined;
snapshot.draft = draftEncoded
  ? ResearchDraft.decode(draftEncoded)
  : new ResearchDraft();
// Works for ANY phase — fixes the phase-gating bug
```

### Lifecycle

```
Fresh run:      snapshot.draft = new ResearchDraft()        // empty, isReady() = false
Drafting phase: snapshot.draft.set(agentResponse)            // state machine captures text
Saving phase:   draft.isReady() → true → phase: done        // state machine checks
Persist:        saveState calls draft.encode() → session     // base64url blob
Restore:        draftEncoded ? decode(buf) : new Draft()     // deterministic decode
Assembly:       draft.get() → report text                   // single reader
```

## Consequences

### What is removed

- **`draftReady`** boolean proxy on session data
- **`draftLength`** number proxy on session data
- **`parsedResponse` re-extraction** in `handleSubsequentCall` (~8 lines at orchestrator.ts:136-142)
- **Phase-gating bug** — orchestrator only restored draft for `phase === "drafting"`, not `"saving"`. After the change, `decode()` works for any phase.
- **`doSaving` fallback branch** — the `if text.length < 40 && parsedResponse` block (state-machine.ts:366-367)
- **Draft recovery logic** in orchestrator — `decode()` is deterministic, no agent-text parsing
- **`tests/draft-persistence.test.ts`** — entire file tests the current persist/restore pattern; replaced by `tests/research-draft.test.ts`

### What changes

| File | Change |
|------|--------|
| `state-machine.ts` | `draftReport: string` → `draft: ResearchDraft`. `doDrafting` calls `draft.set()`. `doSaving` checks `draft.isReady()`. |
| `session-state.ts` | `saveState` calls `draft.encode()` instead of stripping + storing flags |
| `research-run-orchestrator.ts` | `handleSubsequentCall` removes draft-restore block; snapshot carries `draft` field natively after JSON parse → `ResearchDraft.decode()` |
| `report-assembly.ts` | `snapshot.draftReport` → `snapshot.draft.get()` |
| `tests/draft-persistence.test.ts` | **Removed** — replaced by `tests/research-draft.test.ts` |
| `tests/session-state.test.ts` | `draftReport` → `draftEncoded`; `draftReady`/`draftLength` assertions removed |
| `tests/research-run-orchestrator.test.ts` | `snapshot.draftReport` → `snapshot.draft.get()` |
| `tests/integration.test.ts` | `draftReport.length` → `draft.get().length` |
| `tests/report-assembly.test.ts` | Mock snapshots: `draftReport` field → `draft` field |
| `tests/version-telemetry.test.ts` | Mock snapshot: `draftReport: ""` → `draft: new ResearchDraft()` |
| `tests/artifact-links.test.ts` | Mock snapshot: `draftReport: ""` → `draft: new ResearchDraft()` |
| `tests/save-report-features.test.ts` | `draftReport` reference → `draft.get()` |
| **New:** `extension/research-draft.ts` | `ResearchDraft` class (~30 lines) |
| **New:** `tests/research-draft.test.ts` | Encode/decode round-trip, isReady boundary, empty draft |

### Edge cases

| Case | Behavior |
|------|----------|
| Draft not yet ready (`length < 40`) | `encode()` returns `undefined`, nothing persisted |
| Agent re-prompted in drafting → new text | `set()` overwrites — last write wins |
| Session restart while `phase === "saving"`, draft ready | `decode(draftEncoded)` → `doSaving` sees ready → advances to `done`. **Currently broken** — orchestrator only restores draft for `phase === "drafting"`, not `"saving"`. This is the "stuck in saving" bug. `decode()` fixes it for all phases. |
| Session restart while `phase === "drafting"`, draft ready (rare) | `doDrafting` receives current-turn `parsedResponse` → overwrites restored draft via `set()`. The retry re-prompt logic in `doDrafting` (re-injects drafting prompt when text < 40 chars) is unchanged — that is a drafting concern, not a persistence concern. |
| Corrupted encoded blob | `decode()` throws → caught at restore → fall back to empty `ResearchDraft()` → `isReady()` = false → machine blocks in `saving` with clear error (deterministic failure, not silent) |

### Non-breaking

- `ResearchSnapshot` still serializable to JSON — `draft` field is omitted from session entries (only `draftEncoded` string is stored)
- Phase transitions unchanged — same phases, same ordering
- Report assembly path unchanged — same caller (`assembleReport`), same data (`draft.get()`)
- External tools (`save_report`, `export_pdf`) unchanged — they read from the saved file, not the snapshot
- `doDrafting` retry re-prompt unchanged — agent re-prompt when text < 40 chars is a drafting concern, preserved as-is
- 7 existing test files updated (see What Changes table) — `draftReport` field replaced with `draft` field or `draft.get()` call

## Rationale

The triple-path draft handling pattern emerged incrementally: session persistence was added after drafting logic, the strip-and-re-extract pattern was a defensive workaround for session entry size, and the orchestrator restore was a later addition to handle multi-turn state machine execution. None of these steps were individually wrong — but together they created a system where no single module understood the draft lifecycle.

`ResearchDraft` consolidates ownership. The interface is 4 methods + 1 static. The encoding strategy (zlib → base64url) eliminates the size concern without introducing new dependencies. The "stuck in saving" bug becomes structurally impossible — there is no text re-extraction to fail.
