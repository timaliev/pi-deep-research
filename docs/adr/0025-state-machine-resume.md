# ADR-0025: State machine resume — move draft restoration inside the machine

**Date:** 2026-07-15
**Status:** proposed

## Context

`ResearchRunOrchestrator.handleSubsequentCall()` performs four operations that concern the state machine's internal format before calling `machine.next()`:

1. **Extracts agent response text** — calls `extractTextContent(rawResponse)` to strip `<tool_calls>` blocks and normalize content blocks
2. **Restores snapshot from session blob** — reads `stateData` fields (`phase`, `runId`, `currentDepth`, etc.) and reconstructs a `ResearchSnapshot`
3. **Decodes the draft blob** — calls `ResearchDraft.decode(draftEncoded)` to inflate the zlib-compressed draft from the session entry
4. **Resolves artifact directories** — computes `deepResearchBase`, `logsDir`, `artifactsDir` from the plan path

These four operations expose the machine's persistence format across the seam:

```
orchestrator knows: draftEncoded field name
orchestrator knows: ResearchDraft.decode()
orchestrator knows: extractTextContent()
orchestrator knows: "deep-research:state" key
orchestrator knows: snapshot field names
```

The orchestrator's role should be *when* the machine advances, not *how* the machine's state is restored.

## Decision

**Add a `resume(stateBlob, agentResponse)` static or instance method on `ResearchStateMachine`.**

The method accepts the raw session blob (as stored by `SessionState.saveState()`) and the raw agent response (string or content blocks array). It internally:

1. Extracts text from the agent response
2. Restores the snapshot from the blob
3. Decodes the draft via `ResearchDraft.decode()`
4. Returns a ready-to-advance `ResearchSnapshot` or a result object with the next phase

The orchestrator calls:

```typescript
const result = machine.resume(stateBlob, rawResponse);
// result.snapshot is fully restored, result.inject is ready
```

`extractTextContent()` moves from `research-run-orchestrator.ts` to `state-machine.ts` (or a shared module owned by the machine).

Log path resolution stays in the orchestrator — the logger requires `artifactsDir` which the machine shouldn't own.

## Consequences

- **Locality:** draft encoding, blob format, and agent response parsing concentrate in the state machine module
- **Leverage:** orchestrator's `handleSubsequentCall` shrinks to "restore machine state, call next, persist"
- **Seam discipline:** the machine is the single seam for state lifecycle; the orchestrator is the seam for tool→machine dispatch
- **Tests:** draft restoration tested through `machine.resume()`, not through orchestrator integration tests
- **Non-goal:** logger creation stays in the orchestrator — the machine receives a logger via `ResearchContext`, consistent with ADR-0011 (logger locality)
