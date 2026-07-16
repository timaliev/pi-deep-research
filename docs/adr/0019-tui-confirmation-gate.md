# ADR-0019: TUI confirmation gate for research plans

**Date:** 2026-07-09
**Status:** accepted

## Context

The prefilter protocol requires the agent to present the research plan to the user for approval before calling `confirm_research` and `run_research`. In practice, the agent sometimes skips this step:

1. Calls `confirm_research` without user approval, then calls `run_research` — the confirmation gate in `run_research` sees the session entry and passes.
2. Never surfaces the chosen report style (`narrative` vs `subtopics`) to the user. The agent fills it from defaults and the user discovers it only in the final report.

Both failures stem from a trust-me gap: `confirm_research` is a stateless tool with no user-present gate. The SKILL.md guardrails ("Do NOT call until user confirms") are not reliably followed by all models.

## Decision

### Intercept `confirm_research` at the extension level

Use `pi.on("tool_call", ...)` to intercept `confirm_research` before execution. Show a mandatory TUI binary choice:

```
🔬 Research Plan Confirmation

Topic:      {plan.topic}
Engines:    duckduckgo, brave
Profile:    default (breadth=4, depth=2, concurrency=4)
Style:      narrative
Questions:  5
Cost:       ~12 searches, ~8 scrapes

Start deep research?

  1. No — Review plan
  2. Yes — Start research
```

- **Yes** → tool executes, creates `deep-research:plan-confirmed` session entry.
- **No** → `{ block: true, reason: "Confirmation declined by user" }`. Agent must re-attempt.

### Plan artifact reading

Read the prefilter JSON from `params.plan_artifact_path` at intercept time. Extract: `topic`, `engines`, `profile`, `reportStyle`, `researchQuestions.length`, `estimatedCost`. If the file is missing or unreadable, block with an error explaining the path issue.

### Non-interactive mode

In print mode (`-p`), `ctx.hasUI` is `false`. Block by default:
- Reason: "Research plan confirmation requires interactive mode (TUI or RPC). Retry in interactive mode."

This prevents silent auto-confirmation in CI or scripted runs.

### Report style resolution

`reportStyle` may be absent from the plan JSON. Fallback chain: `plan.reportStyle` → `settings.defaultReportStyle` → `"narrative"`. Display the resolved style in the TUI prompt so the user sees it explicitly before confirming.

## Consequences

- **Confirmation is mandatory** — cannot be skipped by any model behavior. The tool will not execute without a human picking "Yes."
- **Report style is always visible** — the TUI prompt surfaces it at decision time.
- **Non-interactive use is blocked** — scripted/CI users must wait for a future `confirm: true` flag in the plan JSON (ADR-0017, Question 8 FUTURE).
- **Tool remains stateless** — the `confirm_research` tool itself doesn't change. The gate is at the extension event level, keeping the tool pure.
- **`confirm_research` description becomes factual** — "Call after user explicitly approves" is now enforced, not requested.

### Implementation

Add to `extension/index.ts`:

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "confirm_research") return undefined;

  const planPath = event.input.plan_artifact_path;
  const artifact = readPlanArtifact(planPath); // reuse shared.ts
  if (!artifact.ok) {
    return { block: true, reason: `Cannot read plan: ${artifact.error}` };
  }

  const plan = artifact.data.plan;
  const style = plan.reportStyle ?? settings.defaultReportStyle ?? "narrative";
  const profile = plan.profile;
  const profileDesc = profile.name === "custom"
    ? `custom (breadth=${profile.breadth}, depth=${profile.depth})`
    : `${profile.name} (breadth=..., depth=..., concurrency=...)`;

  if (!ctx.hasUI) {
    return { block: true, reason: "Confirmation requires interactive mode." };
  }

  const choice = await ctx.ui.select(
    `🔬 Research Plan Confirmation\n\n` +
    `Topic:      ${plan.topic}\n` +
    `Engines:    ${plan.engines.join(", ")}\n` +
    `Profile:    ${profileDesc}\n` +
    `Style:      ${style}\n` +
    `Questions:  ${plan.researchQuestions.length}\n` +
    `Cost:       ${plan.estimatedCost.description ?? `${plan.estimatedCost.searchCalls} searches, ${plan.estimatedCost.scrapeCalls} scrapes`}\n\n` +
    `Start deep research?`,
    ["No — Review plan", "Yes — Start research"],
  );

  if (!choice || !choice.startsWith("Yes")) {
    return { block: true, reason: "Confirmation declined by user" };
  }
  // Allow — tool executes normally
  return undefined;
});
```
