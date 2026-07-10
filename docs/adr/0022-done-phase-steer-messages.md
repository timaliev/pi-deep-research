# ADR-0022: Remove Redundant Steer Messages from Done Phase

**Date**: 2026-07-10
**Status**: proposed

## Context

When `run_research` reaches the done phase, it injects up to 2 steer messages into the conversation via `pi.sendUserMessage()`:

```ts
// run-research.ts — done phase handler

// 1. PDF fallback (always runs when pdfExport enabled but pandoc missing)
pi.sendUserMessage(
  `## PDF Export — Agent Fallback\n\n...\n` +
    `Convert the report to PDF using available tools...`,
  { deliverAs: "steer" },
);

// 2. Mind map prompt (always runs when mindMap enabled)
pi.sendUserMessage(result.mindMapPrompt, { deliverAs: "steer" });
```

These become the LLM's next user message after research completes. The LLM MUST process them even if the user never asked for PDF or mind map. Token cost:

| Steer message | Size |
|--------------|------|
| PDF fallback instructions | ~300 chars (~75 tokens) |
| Mind map prompt (findings) | Up to 3,000 chars (~750 tokens) |

Combined worst case: ~825 tokens of noise injected after every research run.

## Decision

Stop injecting steer messages in the done phase. Instead, inline the action hints into the return content text, where the LLM can read them passively.

**Before** (current — steer injection):
```ts
if (result.pdfResult?.kind === "fallback") {
  pi.sendUserMessage(`## PDF Export — Agent Fallback ...`, { deliverAs: "steer" });
}
if (result.mindMapPrompt) {
  pi.sendUserMessage(result.mindMapPrompt, { deliverAs: "steer" });
}
```

**After** (inline hints in return content):
```ts
let pdfHint = "";
if (result.pdfResult?.kind === "fallback") {
  pdfHint = `\n💡 PDF export failed (${result.pdfResult.error}). Call export_pdf to retry on demand.`;
}
let mindMapHint = "";
if (result.mindMapPrompt) {
  mindMapHint = `\n💡 Mind map available. Call mind_map to generate.`;
}

return {
  content: [{
    type: "text",
    text: `## Research Complete ✅\n\n` +
      `Report saved to: ${reportPath}${pdfHint}${mindMapHint}\n\n` +
      `Search calls: ${result.snapshot.searchCalls}\n...`,
  }],
};
```

The LLM sees the hints in the tool response. If the user wants PDF/mind-map, the LLM calls the tool. Otherwise, no context is burned.

## Consequences

- **Positive**: Done phase context drops by up to 825 tokens per research run.
- **Positive**: LLM no longer forced to process PDF/mind-map instructions when user doesn't need them.
- **Positive**: Same functionality — LLM can still call `export_pdf`/`mind_map` on demand.
- **Negative**: PDF fallback no longer auto-pushes conversion instructions. If user configured `pdfExport: true` but lacks pandoc, they won't see instructions unless they ask. Acceptable — the `done` return text still shows the error. The LLM can offer to convert.
