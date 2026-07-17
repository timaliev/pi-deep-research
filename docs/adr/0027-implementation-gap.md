# ADR-0027 Implementation Gap: plan-research.ts

**Date:** 2026-07-17
**Status:** analysis — implementation pending

## Context

ADR-0027 defined a single-call `plan_research` state machine. `PrefilterManager.next()` was added to `prefilter.ts` as the unified entry point. SKILL.md was updated with the guardrail "Do NOT call `plan_research` again." `estimate_research_cost` tool was removed.

**But `plan-research.ts` was never updated.** It still uses the old 4-branch router with `params_json`/`plan_json` params. The tool's own response text tells the agent to re-call, contradicting the SKILL.md guardrail. The ADR-0027 refinement (self-recovering errors) is also unimplemented.

## Symptoms observed in session 019f70e9

1. Agent bypasses pipeline entirely, does manual search — confused by conflicting messages
2. Tool response says "call plan_research again with params_json" — old protocol, contradicts guardrail
3. `trim()` crash in `handleContinue` when agent tries to advance with no params

## Current state (broken)

```
plan-research.ts execute():
  ┌─ if (topic, no params_json, no plan_json) → handleStart
  ├─ if (params_json, no plan_json)            → handleWithParams
  ├─ if (no params)                            → handleContinue
  └─ if (plan_json)                            → handleFinalize

handleStart      → manager.start(topic)         → inject: "choose engines. call again with params_json"
handleWithParams → manager.withParams(...)       → preliminary search → inject: "create plan"
handleContinue   → manager.continue(llmText)    → introspection/merge
handleFinalize   → manager.finalize(planJson)   → validate → save → TUI

Parameters: topic?, params_json?, plan_json?
```

## Target state (ADR-0027 design)

```
plan-research.ts execute():
  ┌─ parse agent's last text response from session entries
  ├─ determine phase from session state
  ├─ manager.next({ type, ... })
  ├─ if inject → send via pi.sendUserMessage()
  └─ return phase info

Single loop, no branching by params. Tool auto-advances internally.
Agent only ever calls: plan_research({ topic: "..." })

Parameters: topic (string, required)
```

## Reference: PrefilterManager.next() interface

Already implemented in `prefilter.ts:166-181`:

```typescript
type PrefilterInput =
  | { type: "topic"; topic: string }
  | { type: "params"; engines: SearchEngine[]; profile: ResearchPlanProfile }
  | { type: "continue"; llmResponse?: string }
  | { type: "plan"; topic?: string; planJson: string };

async next(input: PrefilterInput): Promise<PrefilterResult> {
  switch (input.type) {
    case "topic":    return this.start(input.topic);
    case "params":   return this.withParams(this.cachedTopic ?? input.engines.join(","), input.engines, input.profile);
    case "continue": return this.continue(undefined, input.llmResponse);
    case "plan":     return this.finalize(input.topic ?? this.cachedTopic ?? "", input.planJson);
  }
}
```

## Reference: PrefilterResult type

```typescript
type PrefilterResult = {
  phase: "awaiting_params" | "awaiting_plan" | "plan_ready" | "error";
  runId: string;
  inject?: string;
  searchResults?: WebSearchResult[];
  plan?: ResearchPlan;
  planArtifactPath?: string;
  error?: string;
}
```

## Implementation plan

### Step 1: Rewrite execute()

Replace the 140-line `execute()` with a loop that:

```
1. Get session entries
2. Get or create PrefilterManager from session state
3. Parse agent's last text response (strip <tool_calls>, extract content)
4. Determine what the agent was responding to (by phase stored in session)
5. Call manager.next() with the appropriate input type
6. If inject → pi.sendUserMessage(inject, { deliverAs: "steer" })
7. Return phase + runId info
```

### Step 2: Phase detection from session

The tool must know which phase the agent's last response corresponds to. Store phase in session via `pi.appendEntry()`:

```typescript
const PREFILTER_PHASE_KEY = "deep-research:prefilter-phase";

// After each manager.next() call, persist phase:
pi.appendEntry(PREFILTER_PHASE_KEY, { runId: result.runId, phase: result.phase });
```

On next call, read phase from session to determine what the agent's response contains:

| Stored phase | Agent's response contains | Next input type |
|---|---|---|
| `awaiting_params` | JSON: `{"engines": [...], "profile": {...}}` | `{ type: "params", ... }` |
| `awaiting_plan` (after introspection inject) | Markdown: LLM knowledge topics | `{ type: "continue", llmResponse }` |
| `awaiting_plan` (after merge inject) | JSON: plan | `{ type: "plan", planJson }` |

### Step 3: Agent response parsing

```typescript
function parseAgentResponse(entries: any[]): string {
  // Find last assistant message
  const last = [...entries].reverse().find((e: any) => e.message?.role === "assistant");
  if (!last?.message?.content) return "";

  // Handle both string and array content blocks
  const content = last.message.content;
  if (typeof content === "string") {
    return content.replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, "").trim();
  }
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, "")
      .trim();
  }
  return "";
}
```

### Step 4: JSON extraction from agent response

Agent responses may contain JSON wrapped in markdown fences or as raw text:

```typescript
function extractJson(text: string): object | null {
  // Try markdown code fence
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence?.[1]?.trim() ?? text.trim();

  // Try raw JSON
  try { return JSON.parse(jsonText); } catch {}

  // Try to find JSON object in text
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }

  return null;
}
```

### Step 5: Self-recovering errors (ADR-0027 refinement)

Per ADR-0027, the tool must never return `phase: "error"` to the agent. All error states are recoverable:

```
function handleError(error: string, currentPhase: string, retryCount: number): RecoveryAction {
  // Invalid JSON → re-inject with guidance (max 3 retries)
  if (error.includes("Invalid JSON") || error.includes("JSON")) {
    if (retryCount >= 3) return { type: "fallback_error", message: "..." };
    return { type: "reinject", phase: currentPhase,
      guidance: "Please provide valid JSON. Use ```json fences." };
  }

  // Introspection skipped → auto-inject introspection prompt
  if (error.includes("Plan submitted without completing")) {
    return { type: "reinject", phase: "introspecting",
      inject: buildIntrospectionPrompt(cachedTopic) };
  }

  // Missing required fields → re-inject with field-specific guidance
  // ... (extract validation errors from plan artifact)

  // No cached prefilter state → restart from start phase
  if (error.includes("No topic provided") || error.includes("no cached")) {
    return { type: "restart" };
  }

  // Already finalized → idempotent — return existing plan_ready
  // ... (check if plan artifact exists for this topic)
}
```

### Step 6: Remove old code

Delete from `plan-research.ts`:
- `handleStart()`
- `handleWithParams()`
- `handleContinue()`
- `handleFinalize()`
- 4-branch `if/else` router
- `params_json` and `plan_json` from `Type.Object()`

### Step 7: Update tool schema

```typescript
parameters: Type.Object({
  topic: Type.String({ description: "Research topic" }),
})

description: "Plan a deep research. Call once with topic. Tool auto-advances through engine/profile selection, LLM introspection, preliminary search, and plan creation. Just respond to the injected prompts."
```

## Edge cases

| Case | Behavior |
|------|----------|
| Agent responds with malformed JSON | Re-inject with format guidance. Max 3 retries, then fallback error |
| Agent calls with different topic mid-flow | Create new PrefilterManager for new topic |
| Session restart mid-prefilter | Phase stored in session entries → resume from last phase |
| Agent skips introspection (goes straight to plan) | Auto-inject introspection prompt, wait for response |
| Plan artifact already exists for topic | Idempotent — return existing plan_ready with path |
| PrefilterManager in error state | Auto-restart from start phase |

## Files changed

| File | Change |
|------|--------|
| `extension/tools/plan-research.ts` | Complete rewrite of execute() (~100 lines → ~150 lines, different content) |
| `tests/plan-research-dispatch.test.ts` | Replace handler-method tests with new protocol tests |
| `skill/SKILL.md` | No changes — guardrail already correct |

## Files NOT changed

- `extension/prefilter.ts` — `next()` already correct
- `extension/prefilter-prompts.ts` — injection prompts already correct
- `extension/session-state.ts` — may add `PREFILTER_PHASE_KEY` constant
- `extension/confirm-dialog.ts` — already correct, called inline during finalize

## Risks

- **State synchronization**: Phase tracking via session entries must stay in sync with PrefilterManager internal phase. If they diverge, tool advances incorrectly.
- **Agent response parsing**: Must handle content blocks (arrays), string content, and mixed formats across different LLM providers.
- **JSON extraction**: Agent may wrap JSON in markdown fences, code blocks, or plain text. Multiple extraction strategies needed.
