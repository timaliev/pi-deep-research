# ADR-0021: `save_report` — `report_path` for Large Reports

**Date**: 2026-07-09
**Status**: proposed

## Context

`save_report` requires the full report text as a `markdown` string parameter. When reports are large (50K+ characters), this exceeds the LLM's function-call argument size limit. The LLM responds with:

> "The combined report is too large for a single call. Let me write it to the filesystem directly in parts using bash"

This pollutes the agent conversation and breaks the tool flow.

Meanwhile, `run_research` already auto-saves the report to disk via `assembleReport()` — so `save_report` is partially redundant in the deep-research pipeline. However, `save_report` remains useful as a standalone tool for manual report saving outside the deep-research flow.

## Decision

Add an optional `report_path` parameter to `save_report`. When provided, the tool reads the markdown content from disk instead of requiring it as a parameter.

**New schema**:

```ts
parameters: Type.Object({
  topic: Type.String({ description: "Research topic (used in filename)" }),
  markdown: Type.Optional(Type.String({ description: "Report content in markdown" })),
  report_path: Type.Optional(Type.String({
    description: "Path to an existing report file to re-save (for large reports)"
  })),
})
```

**Resolution logic**:

1. If `report_path` is provided and exists on disk → read content from file
2. Else if `markdown` is provided → use it directly (existing behavior)
3. Else → return error: `missing_content`

**LLM usage pattern after `run_research` completes**:

```
save_report({ topic: "Research Topic", report_path: "<path from run_research result>" })
```

No need to pass the full content — just the path returned by `run_research`.

## Consequences

- **Positive**: Large reports no longer cause LLM tool-arg overflow. Deep-research delivery is reliable.
- **Positive**: Fully backward-compatible — existing calls with `markdown` param continue working.
- **Positive**: Works for both deep-research pipeline (pass auto-saved path) and standalone manual saves (pass markdown).
- **Negative**: None. `report_path` is optional and additive.
