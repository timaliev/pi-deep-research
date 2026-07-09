# ADR-0016: Move post-processing to orchestrator, extract MindMapInjector

**Date:** 2026-07-09
**Status:** accepted ✓ (implemented 2026-07-09)

## Context

Post-processing after a Research Run — PDF auto-export and mind-map auto-generation — is currently wired in the tool handler (`tools/run-research.ts`), not in the orchestrator. This contradicts ADR-0013 ("The mapping phase lives in the Research Run Orchestrator, not the state machine") and ADR-0014 ("the orchestrator invokes the same conversion logic").

Additionally, the mind-map injection prompt template is duplicated verbatim between `index.ts:208` (standalone `mind_map` tool) and `tools/run-research.ts:102` (auto-generation). Both construct identical prompts: "Create a Mermaid `graph TD` mind map for: {topic}…"

## Decision

### 1. Orchestrator owns post-processing

`ResearchRunOrchestrator` constructor accepts `SettingsContext` and reads `pdfExport` / `mindMap` settings internally. The `handle()` method returns an extended `done` result containing post-processing outputs:

```typescript
type OrchestratorResult =
  | { kind: "error"; ... }
  | { kind: "in_progress"; ... }
  | { kind: "done";
      snapshot: ResearchSnapshot;
      plan: ResearchPlan;
      planArtifactPath: string;
      deepResearchBase: string;
      logsDir: string;
      reportPath?: string;  // undefined when settings absent (test mode)
      pdfResult?: { kind: "success"; outputPath: string; method: string }
                 | { kind: "fallback"; error: string; outputPath: string };
      mindMapPrompt?: string;
    }
```

### 2. `assembleReport()` moves to orchestrator

The call to `assembleReport()` (currently in `tools/run-research.ts`) moves into `ResearchRunOrchestrator`. The tool handler receives a pre-assembled `reportPath` — no longer needs to import `report-assembly.ts`.

### 3. MindMapInjector module

New module `extension/mind-map-injector.ts` with a single exported function:

```typescript
function buildMindMapPrompt(
  topic: string,
  findings?: Finding[],
  rawContent?: string,
  savePath?: string,
): string
```

**Two callers, same function:**

| Caller | Input | Context |
|--------|-------|---------|
| Orchestrator (auto-gen) | `findings: Finding[]` (up to 30, truncated) | After state machine `done`, if `settings.mindMap` |
| Standalone `mind_map` tool | `rawContent: string` (params.content) | Always available |

Both produce the same formatted prompt: "Create a Mermaid `graph TD` mind map for: {topic}…"

### 4. Standalone `mind_map` tool shrinks

The inline `execute()` in `index.ts` reduces from 35 lines to 5:

```typescript
async execute(_toolCallId, params) {
  const prompt = buildMindMapPrompt(params.topic, undefined, params.content, params.save_path);
  pi.sendUserMessage(prompt, { deliverAs: "steer" });
  return { content: [...], details: { topic, save_path: params.save_path } };
}
```

### 5. Tool handler becomes thin dispatcher

`tools/run-research.ts` after the change:

```typescript
if (result.kind === "done") {
  session.saveReportPath(result.reportPath, settings.reportsDir, "", result.snapshot.runId);

  if (result.pdfResult?.kind === "fallback") {
    pi.sendUserMessage(
      `## PDF Export — Agent Fallback\n\n${result.pdfResult.error}\n\n…`,
      { deliverAs: "steer" },
    );
  }
  if (result.mindMapPrompt) {
    pi.sendUserMessage(result.mindMapPrompt, { deliverAs: "steer" });
  }

  return {
    content: [{ type: "text", text: `## Research Complete ✅\n\nReport saved to: ${result.reportPath}…` }],
    details: { phase: "done", report_path: result.reportPath, run_id: result.snapshot.runId },
  };
}
```

No more imports of `assembleReport`, `convertToPdf`, or mind-map template logic.

## Consequences

### What is removed

- **`assembleReport` import** from `tools/run-research.ts`
- **`convertToPdf` import** from `tools/run-research.ts`
- **Mind-map injection prompt** from `tools/run-research.ts` (~12 lines)
- **PDF fallback logic** from `tools/run-research.ts` (~20 lines)
- **Mind-map injection prompt duplication** between `index.ts` and `run-research.ts`

### What changes

| File | Change |
|------|--------|
| `extension/research-run-orchestrator.ts` | Constructor gains optional `settings?: SettingsContext`. `handle()` conditionally does `assembleReport()` + PDF + mind-map when settings present. Returns extended `done` result with optional `reportPath`, `pdfResult`, `mindMapPrompt`. |
| `extension/tools/run-research.ts` | Shrinks: imports removed, post-processing removed. Only delivery of fallback messages remains. |
| `extension/index.ts` | `mind_map` tool execute() shrinks from 35 → 5 lines. Imports `buildMindMapPrompt`. Standalone `export_pdf` tool unchanged. |
| **New:** `extension/mind-map-injector.ts` | `buildMindMapPrompt()` — single prompt template (~20 lines) |
| **New:** `tests/mind-map-injector.test.ts` | Tests for both caller patterns (findings + rawContent) |
| `tests/research-run-orchestrator.test.ts` | Existing tests pass unchanged (settings absent → no post-processing). New tests for post-processing path with mock settings. |
| `tests/auto-export*.test.ts` | Updated to reflect new orchestrator responsibility |

### Decluttered tool handler (before vs after)

```
Before: run-research.ts
├── assembleReport()          [moves to orchestrator]
├── session.saveReportPath()   [stays]
├── if pdfExport: convertToPdf + fallback + pi.sendUserMessage  [moves]
├── if mindMap: build prompt + pi.sendUserMessage                [moves]
└── return done response      [stays]

After: run-research.ts
├── session.saveReportPath()
├── if pdf fallback: pi.sendUserMessage()
├── if mindMap: pi.sendUserMessage()
└── return done response
```

### Non-breaking

- Both `mind_map` standalone tool and auto-generation produce identical prompts — same agent behavior
- PDF auto-export unchanged — same pandoc/fallback logic, now called from orchestrator
- `export_pdf` standalone tool unchanged — always available, independent of settings
- Test surface same — PDF and mind-map tests updated but behavior unchanged. Existing orchestrator tests pass unchanged because `settings` is optional.

### Rationale

The tool handler grew post-processing logic incrementally: PDF export (ADR-0014) was wired in the tool handler because it needed `pi.sendUserMessage` for fallback injection, and mind-map (ADR-0013) followed the same pattern. Both ADRs explicitly specify orchestrator-gating, but the implementation shortcut was "tool handler has Pi API access, put it there."

The correct architecture: orchestrator assembles the complete result, tool handler delivers messages. The orchestrator now accepts `SettingsContext` for internal feature-gating, and returns structured post-processing outputs. The tool handler's only remaining responsibility is message delivery — pure orchestration boundary.

## Implementation Notes

### `settings` is optional in `OrchestratorDeps`

`SettingsContext` is a singleton that reads from disk — this complicates orchestrator unit tests. To keep tests self-contained:

```typescript
export interface OrchestratorDeps {
  // ... existing fields ...
  settings?: SettingsContext;  // optional — absent in tests, present in production
}
```

When `settings` is absent, the orchestrator skips all post-processing: no `assembleReport()`, no PDF export, no mind-map generation. `OrchestratorResult.done.reportPath` and `pdfResult`/`mindMapPrompt` become `undefined`. The tool handler handles missing `reportPath` gracefully (no `saveReportPath` call).

Existing `artifactsDir` and `searchCred` fields remain on `OrchestratorDeps` for backward compatibility. In production, `settings.artifactsDir` and `settings.credentials` duplicate them — but keeping both avoids breaking changes to the constructor interface.

### Findings truncation for mind-map prompt

The orchestrator truncates findings before calling `buildMindMapPrompt`:

```typescript
const findingsSummary = snapshot.allFindings
  .slice(0, 30)
  .map((f, i) => `${i + 1}. ${f.text.substring(0, 200)}`)
  .join("\n");
const mindMapPrompt = buildMindMapPrompt(plan.topic, findingsSummary, undefined, undefined);
```

`buildMindMapPrompt` receives the pre-formatted string as `findings` (not raw `Finding[]`). This keeps the injector module agnostic to the `Finding` type — it only formats a prompt given a topic and optional content strings.

### Standalone `export_pdf` tool unchanged

`index.ts` keeps its own import of `convertToPdf` for the standalone `export_pdf` tool. The orchestrator imports `convertToPdf` independently for auto-export. Two import sites, used by two different modules — not duplication, different responsibilities.

### `convertToPdf` return type

`convertToPdf()` returns `{ kind: "success" | "error" | "fallback", ... }`. The orchestrator maps `"error"` (system tool missing) to `{ kind: "fallback", error, outputPath }` in `pdfResult` — the tool handler then injects the fallback prompt. The `"success"` case is returned as-is; the `"error"` case (report not found) is returned as an orchestrator error (not `done`).
