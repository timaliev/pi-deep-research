# ADR-0027: Single-call plan_research state machine

**Date:** 2026-07-17
**Status:** accepted

## Context

`plan_research` currently requires the agent to call it 4-6 times with different parameter combinations to complete the prefilter pipeline:

1. `plan_research({ topic })` — phase: start
2. `plan_research({ topic, params_json })` — phase: withParams
3. `plan_research()` — phase: introspect
4. `plan_research()` — phase: merge
5. `plan_research({ plan_json })` — phase: finalize
6. (confirmation TUI happens inline during finalize)

The tool routes to the correct handler by inspecting which params are present. The agent must remember the exact param combination for each call.

This causes three problems:

1. **Agent stops mid-flow.** The agent writes "I need to call plan_research() with no parameters" as text instead of calling the tool. Observed in multiple sessions (019f6bff, 019f6ca7, 019f6fd6).
2. **Phase confusion.** The agent may call the wrong combination (e.g., `plan_research({ plan_json })` before introspection, which the enforcement guard now blocks — but the error recovery is another round-trip).
3. **Fragile routing.** The 4-branch `if/else` in the tool execute function mirrors the state machine's internal routing. Two places encoding the same phases — they must stay in sync.

The phases are a **fixed linear pipeline** with zero rational reason to reorder them. The same pattern was already solved for `run_research` — call it repeatedly with no params, the tool advances internally.

## Decision

**Replace multi-call plan_research with a single-call state machine — same pattern as run_research.**

Agent calls `plan_research({ topic: "..." })` once. The tool:

1. Sends engine/profile selection prompt → waits for agent response
2. Receives params → runs preliminary search → sends plan prompt
3. Receives agent's plan topics (introspection) → runs merge search → sends merge prompt
4. Receives merged plan → validates, saves artifact → runs confirmation TUI
5. Returns confirmed/cancelled result

The tool manages all state internally via `pi.appendEntry()`. At each step that requires agent input, the tool injects a prompt via `pi.sendUserMessage()` and returns. The agent responds in its next turn as text. Behind the scenes, the tool reads the agent's response from session entries on the next call and advances the phase.

**API:**

```
plan_research({ topic: "..." })
// → injection: "Choose engines and profile. Reply with JSON."
// agent responds with JSON

// (agent calls plan_research again — tool detects agent response and advances)
// → injection: "Propose topics from internal knowledge."
// agent responds with markdown

// → injection: "Produce final plan JSON."
// agent responds with JSON

// → validation, save, TUI dialog
// → returns: "Research confirmed" or "Plan cancelled"
```

The `plan_research` call signature no longer has `params_json`, `plan_json`, or zero-param variants. Just `{ topic }`.

`estimate_research_cost` tool is removed. Cost is now computed by the tool itself: `profile.breadth × profile.depth × researchQuestions.length` for searches, `ceil(searches × 1.5)` for scrapes. Same algorithm, but built into the pipeline — no separate tool call needed. The TUI shows the computed cost, not the agent's plan JSON estimate.

Phase 1 guardrail "retry without engines missing API keys" is now unnecessary — the tool auto-filters engine choices against `enabledEngines` at runtime.

## Consequences

- **No phase confusion.** One entry point, one state machine, zero agent routing decisions.
- **No mid-flow stops.** Tool auto-advances after agent response. Agent never needs to "decide which phase is next."
- **Same pattern as run_research.** Familiar to agents and maintainers.
- **estimate_research_cost removed.** Cost computed by the tool using the same algorithm (`breadth × depth × questions`). No separate tool call needed. The TUI shows computed cost regardless of what the agent wrote in the plan.
- **PrefilterManager simplified.** The multi-call routing logic (`start`, `withParams`, `continue`, `finalize`) collapses into a single `next()` method with phase dispatch — same pattern as `ResearchStateMachine.next()`.
- **Breaking change.** Old sessions with saved prefilter state will fail. Acceptable — the old flow was already broken by the enforcement guard.

## Refinement: Self-recovering errors (July 2026)

The tool must never return `phase: "error"` to the agent. All error states are recoverable within the tool — the tool re-injects the appropriate prompt or auto-advances. The agent never makes error-recovery decisions.

| Error state | Recovery |
|---|---|
| Invalid JSON from agent | Re-inject plan prompt with syntax guidance. Max 3 retries, then return fallback error |
| Already finalized | Idempotent — return existing `plan_ready` with saved artifact path |
| Introspection skipped | Auto-inject introspection prompt, wait for agent response, continue normally |
| Missing required fields | Re-inject plan prompt with field-specific guidance (e.g., "Missing: goal, scope") |
| No cached prefilter state | Restart from `start` phase — auto-create new manager |

**getOrCreate restart fix:** When agent calls `plan_research({ topic })` again after an error, `PrefilterSession.getOrCreate` must create a fresh `PrefilterManager` instead of reusing the stale instance. This is detected by checking if the existing manager's phase is beyond `awaiting_params`.

**Impact:** The SKILL.md "fix the issue and call plan_research again" instruction becomes unnecessary — the tool handles recovery internally. Can be removed from the protocol.
