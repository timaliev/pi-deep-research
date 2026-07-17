# ADR-0027: Single-call plan_research state machine

**Date:** 2026-07-17
**Status:** proposed

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

`estimate_research_cost` is removed — it was never called in the normal flow (cost is shown in the TUI).

Phase 1 guardrail "retry without engines missing API keys" is now unnecessary — the tool auto-filters engine choices against `enabledEngines` at runtime.

## Consequences

- **No phase confusion.** One entry point, one state machine, zero agent routing decisions.
- **No mid-flow stops.** Tool auto-advances after agent response. Agent never needs to "decide which phase is next."
- **Same pattern as run_research.** Familiar to agents and maintainers.
- **estimate_research_cost removed.** Dead tool since inline confirmation was added (ADR-0026).
- **PrefilterManager simplified.** The multi-call routing logic (`start`, `withParams`, `continue`, `finalize`) collapses into a single `next()` method with phase dispatch — same pattern as `ResearchStateMachine.next()`.
- **Breaking change.** Old sessions with saved prefilter state will fail. Acceptable — the old flow was already broken by the enforcement guard.
