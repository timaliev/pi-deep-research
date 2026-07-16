# Architecture Review — July 2026

Surface architectural friction and propose deepening opportunities across the deep-research extension.

Vocabulary: **module**, **interface**, **implementation**, **depth**, **shallow**, **seam**, **adapter**, **leverage**, **locality** (see [LANGUAGE.md](../../.agents/skills/improve-codebase-architecture/LANGUAGE.md)). Domain terms from [CONTEXT.md](../CONTEXT.md).

---

## 1. ~~Bundle PrefilterManager constructor into PrefilterContext~~ ✅ DONE (ADR-0024)

**Strength:** Strong — **Implemented July 2026**
**Files:** `extension/prefilter.ts`, `extension/tools/plan-research.ts`
**ADR:** [0024-prefilter-context-bundle.md](adr/0024-prefilter-context-bundle.md) (accepted)

### Problem

`PrefilterManager` constructor takes 10 positional parameters, 5 of them optional:

```
(searchFn, scraper, artifactsDir, logger?, profileResolver?, searchCred?, sharedRunId?, defaultReportStyle?, enabledEngines?)
```

This is the exact same dependency cluster that `ResearchContext` solved for `ResearchStateMachine` in ADR-0007. ADR-0007 explicitly deferred PrefilterManager: *"kept with positional params for now — can be refactored in a follow-up."*

### Solution

Introduce a `PrefilterContext` bundle — a typed object passed to the constructor instead of 10 positional args. Same shape as `ResearchContext`. The caller (`PrefilterSession`) already has all dependencies available — it just spreads them across positional slots.

### Benefits

- **Locality:** add a dependency without touching every call site
- **Leverage:** one interface type, two modules that use it (PrefilterManager, PrefilterSession)
- **ADR-0007 precedent:** same pattern, same reasoning, same codebase
- Five optional params collapse to one optional field

---

## 2. ~~Stop orchestrator from decoding the state machine's draft blob~~ ✅ DONE (ADR-0025)

**Strength:** Strong — **Implemented July 2026**
**Files:** `extension/research-run-orchestrator.ts`, `extension/state-machine.ts`
**ADR:** [0025-state-machine-resume.md](adr/0025-state-machine-resume.md) (accepted)

### Problem

`ResearchRunOrchestrator.handleSubsequentCall()` manually decodes the draft blob, extracts agent text, and reassembles the snapshot before calling `machine.next()`. Four things leak across the seam:

- `ResearchDraft.decode()` — draft encoding format
- `extractTextContent()` — agent response parsing
- `"deep-research:state"` — session key constant
- `draftEncoded` — field name on session data blob

The machine's persistence format is exposed to the orchestrator.

### Solution

Add a `resume(stateBlob, agentResponse)` method on `ResearchStateMachine`. It internally decodes drafts, extracts text, and restores its snapshot. The orchestrator passes the raw session blob and raw agent response through the seam without unpacking. The machine also takes ownership of `extractTextContent()`.

### Benefits

- **Locality:** draft encoding, blob format, and agent parsing in one module
- **Leverage:** orchestrator shrinks to "advance machine, persist result"
- Two seams become one: the machine is the single seam for state lifecycle
- Tests: draft restoration tested through machine interface, not orchestrator

---

## 3. ~~Make PrefilterManager.continue() an explicit state machine~~ ✅ DONE

**Strength:** Worth exploring — **Implemented July 2026**
**Files:** `extension/prefilter.ts`, `extension/tools/plan-research.ts`

### Problem

`continue()` routes between 4 behaviours (`start`, `introspect`, `merge`, `error`) using internal flags (`lastSearchResultCount`, `cachedTopic`, `introspectionDone`). These flags are implicit state machine phases checked with if/else. The tool handler in `plan-research.ts` also has a 4-branch router that partially mirrors this logic. Two modules split the same state machine.

### Solution

Make `continue()` a proper phase dispatch: `awaitingParams → awaitingPlan → introspecting → merging → awaitingPlan → planReady`. Replace internal flags with an explicit `phase` field. The tool handler's 4-branch router becomes a thin call-through.

### Benefits

- **Locality:** prefilter flow logic in one module, not split across tool + manager
- Each phase transition testable independently through the machine interface
- Same phase-dispatch pattern as `ResearchStateMachine`

---

## 4. ~~Collapse always-on PostProcessors into the done-phase method~~ ✅ DONE

**Strength:** Worth exploring — **Implemented July 2026**
**Files:** `extension/research-run-orchestrator.ts`

### Problem

Two of four `PostProcessor` adapters are always enabled. `ContradictionProcessor` does a trivial string match on findings (3 `includes` checks). `AssembleReportProcessor` wraps `assembleReport()` which is always called. The pipeline pattern is real for `PdfExportProcessor` and `MindMapProcessor` (gated, may fail, have external deps), but the two always-on adapters provide no leverage from being in the pipeline vs. inline.

One adapter = hypothetical seam. Only gated adapters justify the pipeline seam.

### Solution

Inline report assembly and contradiction detection into `buildDoneResult()`. Keep only the two gated adapters (`PdfExportProcessor`, `MindMapProcessor`) in the pipeline.

### Benefits

- **Locality:** report-writing logic lives in the method that writes reports
- Pipeline shrinks from 4 adapters to 2 — only the ones that vary
- `ContradictionProcessor` had no second adapter to justify the seam

---

## 5. ~~Make ReportStyle factory reject unknown styles~~ ✅ DONE

**Strength:** Speculative — **Implemented July 2026**
**Files:** `extension/report-styles.ts`

### Problem

`createReportStyle(name)` silently returns narrative for any unrecognized name. A typo in the plan's `reportStyle` field silently degrades to the wrong template with no feedback.

### Solution

Return `undefined` for unknown names, or throw. Push the defaulting decision to the caller (state machine), which already has `defaultReportStyle`.

### Benefits

- **Interface:** explicit contract — valid names or nothing
- Defaulting moves to one place (state machine constructor), not hidden in factory

---

## Top Recommendation

**All 5 findings implemented July 2026.**
