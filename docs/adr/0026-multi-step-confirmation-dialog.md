# ADR-0026: Multi-step TUI confirmation dialog with parameter editing

**Date:** 2026-07-16
**Status:** accepted

## Context

ADR-0019 introduced a single-step TUI confirmation gate: the user sees the plan summary and picks "Yes — Start research" or "No — Review plan." The "No" path returns to the chat where the LLM must re-negotiate parameters — an LLM round-trip that's slow and error-prone.

Users frequently want to change one parameter (engines, profile, report style) after seeing the plan. The current flow requires: close TUI → tell LLM → LLM re-calls `plan_research` with new params → new prefilter → new TUI. This is 3-4 LLM turns for a 30-second parameter tweak.

Additionally, the only way to abandon a plan is to close the TUI and tell the LLM to stop — there's no explicit "cancel" path.

## Decision

**Replace the single-choice TUI with a 3-step dialog that handles confirmation, parameter editing, and cancellation natively — no LLM involved.**

```
Step 1 (main):     [Confirm]  [Change parameters]  [Cancel]
Step 2 (param):    [Engines]  [Profile]  [Style]  [Back to main]
Step 3 (value):    Show current value + options + [Back to params]
```

### Step 1 — Confirm / Change / Cancel

- **Confirm:** Write confirmation marker, return to caller. Same as current "Yes."
- **Change parameters:** Enter Step 2.
- **Cancel:** Delete the `prefilter.json` artifact if it exists. Plan is gone. Caller receives a cancellation signal.

### Step 2 — Parameter selection

Lists parameters with their current values:
```
[Engines: duckduckgo, tavily]
[Profile: deep (breadth=6, depth=3, concurrency=4)]
[Style: narrative]
[Back to main]
```

User selects one to edit → Step 3.

### Step 3 — Value editing

- **Engines:** Multi-select from `enabledEngines` list (checkboxes via repeated selects).
- **Profile:** Select preset name from available profiles (including user-defined `custom` profiles from settings.json). If "custom," enter `breadth`/`depth`/`concurrency` via sequential `input` dialogs.
- **Style:** Select `narrative` or `subtopics`.
- **Back:** Return to Step 2.

After editing, the plan artifact is updated in-place (same file, same runId). User returns to Step 2. When user goes Back → Step 1, the plan summary reflects updated values.

### Re-entry idempotency

If `confirmPlanDialog` is called again (e.g., via standalone `confirm_research` tool), the existing confirmation marker is found and the dialog returns `confirmed: true` immediately — same idempotency as before.

### Implementation

- Replace `confirmPlanDialog()` with `confirmPlanDialog(ctx, plan, profileResolver, settings, planArtifactPath)` — adds `planArtifactPath` for in-place updates and deletion.
- Pi TUI primitives: `ctx.ui.select()`, `ctx.ui.input()`, `ctx.ui.confirm()`.
- Profile resolution uses `ProfileResolver` to get `listNames()` and `getPresets()`.
- `planArtifactPath` parameter enables the Cancel action to delete the file.

## Consequences

- **No LLM needed** for parameter changes — 30 seconds vs. 3-4 LLM turns.
- **Explicit cancel** removes abandoned plans from disk.
- **4-entry dialog** (Step 2) with back-navigation — simple enough for keyboard-only interaction.
- **Backward compatible:** `confirm_research` tool continues to work; idempotency preserved.
- **Increased complexity:** Single `ctx.ui.select()` becomes a looped state machine with 3 levels. Tests must simulate TUI choices via mocked `ctx.ui`.
