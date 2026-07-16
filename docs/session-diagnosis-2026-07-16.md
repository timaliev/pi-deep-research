# Session 019f6bd9 Diagnosis — July 2026

Root cause analysis for three issues reported during deep research session.

---

## 1. `reportStyle` setting ignored — always defaults to `narrative`

**Symptom:** User's `~/.pi/settings.json` (or `<cwd>/.pi/settings.json`) has `"deepResearch": { "reportStyle": "subtopics" }` but all settings logs show `reportStyle: narrative | source: default`. The local setting is never read.

**Root cause:** Settings key mismatch. The README and user config use `reportStyle`, but `SettingsContext` reads `defaultReportStyle`:

```typescript
// settings-context.ts:193
[this.reportStyle, this.reportStyleSource] = resolveReportStyleWithSource(
  envString(ENV.reportStyle),
  localDr.defaultReportStyle,   // ← should be localDr.reportStyle
  globalDr.defaultReportStyle,  // ← should be globalDr.reportStyle
  ...
);
```

`localDr.defaultReportStyle` is `undefined` → falls through to BUILTIN `"narrative"` every time.

**Fix:** Change to `localDr.reportStyle` and `globalDr.reportStyle` in `settings-context.ts:193-194`.

**Files:** `extension/settings-context.ts`

---

## 2. Agent says `subtopics` but TUI dialog shows `narrative`

**Symptom:** The agent's "Ready to Launch" summary says report style is `subtopics`, but the `confirmPlanDialog` TUI shows `narrative`. User is confused which is correct.

**Root cause:** Two-part:
1. The agent wrote `"reportStyle": "narrative"` in the plan JSON (the agent hallucinated `subtopics` in conversation but didn't update the actual JSON)
2. When the agent tried to re-submit with `subtopics`, the `finalize()` enforcement (from `fix/enforce-introspection-flow`) rejected direct plan submission with `## Plan Error ❌`

**The TUI is authoritative** — it reads from the plan artifact. The agent's discussion of subtopics was incorrect.

**Fix:** Two-part:
1. Add `**Style:** narrative` to the `plan_research` confirmation output so the agent reads the actual style from the tool result
2. Improve the enforcement error message for re-planning: suggest calling `plan_research` with `topic` and `params_json` first, then continue through the flow, then submit the updated plan

**Files:** `extension/tools/plan-research.ts`, `extension/prefilter.ts`

---

## 3. `## Plan Error ❌` when trying to change report style

**Symptom:** User asked agent to change report style from narrative to subtopics. Agent attempted to submit a new plan JSON. Got `## Plan Error ❌: Plan submitted directly without preliminary search.`

**Root cause:** New enforcement from `fix/enforce-introspection-flow` correctly blocked direct plan submission without the full prefilter flow. This is working as designed — but the error message doesn't guide the agent toward the correct fix (re-running the full `start → withParams → continue() → finalize()` flow with the updated report style).

**Fix:** Improve the error message to suggest the correct re-planning path. Current message:
```
Plan submitted directly without preliminary search.
Use the full prefilter flow: start with the topic, then call
plan_research with params_json for engine/profile selection,
then continue() for LLM introspection, then submit your plan.
```
Add: `To update an existing plan (e.g., change report style), you must re-run the full flow with your updated parameters.`

**Files:** `extension/prefilter.ts`

---

## Priority

| # | Severity | Fix effort |
|---|---|---|
| 1 | High — user cannot use settings.json for reportStyle | 1 line |
| 2 | Medium — agent miscommunication | 3 lines |
| 3 | Low — enforcement working, message clarity | 2 lines |
