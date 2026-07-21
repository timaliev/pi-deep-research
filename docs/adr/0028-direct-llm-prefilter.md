# ADR-0028: Subprocess prefilter — supersedes ADR-0001 for plan_research

**Date:** 2026-07-18
**Status:** accepted ✓ (implemented 2026-07-18)

## Implementation Notes (July 2026)

Implemented via `tools/plan-research.ts` with `subprocess-runner.ts`:

- **Subprocess**: `pi --mode json -p --no-session --no-extensions --model <model>`
- **Two calls**: introspection (buildIntrospectionPrompt) → merge/plan (buildMergePrompt)
- **Retry**: introspection retries once on failure; plan creation retries once with stricter prompt on JSON parse failure
- **JSON extraction**: `validateAndSavePlan` handles markdown fences, bare JSON, embedded JSON
- **Cost computation**: `injectEstimatedCost()` computes `breadth × depth × questions` per ADR-0027
- **Scraping**: Top N pages scraped (configurable) and passed to merge prompt with actual settings values
- **Settings**: `prefilterModel` (fast model), `prefilterTimeoutMs` (120s default), `prefilterScrapeCount` (3), `prefilterScrapeChars` (2000)
- **Logging**: `logLevel: "verbose"` captures prompts, raw output, timing per stage
- **Progress**: `onUpdate` reports stage progress with timing to the user
- **Extensions disabled**: `--no-extensions` prevents deep-research loading recursively
- **Unified runId**: same runId across prefilter log, plan artifact, research log

## Context

Three failed iterations of `plan_research`:

1. **Multi-call protocol** (original): agent called tool 4-6 times with different parameter combos. Agent forgot which phase, called wrong params, stopped mid-flow. Rejected by ADR-0027.

2. **Single-call injection** (ADR-0027 implementation): tool injects prompts via `pi.sendUserMessage()`, agent responds as text, tool reads from session entries. Agent must split across turns (respond then re-call). Agent calls in same turn → response not in entries. Agent confused by "do I call again or not?" Same fragmentation as multi-call.

3. **Current state**: `topic` made optional so agent can call `plan_research()` to advance. Still requires turn-splitting discipline. Still fragile.

**Root cause**: ADR-0001's injection pattern is wrong for prefilter. Prefilter doesn't need conversational agent reasoning — it needs two structured LLM completions (introspection, plan creation) embedded between deterministic search/scrape steps. Pi has no API for direct LLM calls from tool context, but the official `subagent` extension proves a working pattern: spawn `pi --json` as a child process.

ADR-0001 rejected subprocess specifically because of model config duplication and UI loss. Both concerns are obsolete: `--model` flag shares the active model, and TUI confirmation stays in the parent process.

## Decision

**`plan_research` spawns a `pi` subprocess for LLM-requiring steps (introspection + plan creation). Everything else is deterministic tool code.**

### Architecture

```
plan_research({ topic: "Apple M5 Ultra" })
  │
  ├─ 1. Resolve engines/profile:
  │      settings.defaultProfile → settings.enabledEngines → built-in defaults
  │      (overridable via TUI in step 5)
  │
  ├─ 2. Preliminary web search (sync)
  │      searchFn(topic, 3, resolvedEngines)
  │      scrape top 2 results
  │
  ├─ 3. Spawn subprocess — one pi process, back-to-back messages:
  │      ┌─ Message 1: buildIntrospectionPrompt(topic)
  │      │   → capture: LLM knowledge topics (markdown)
  │      │
  │      ├─ Merge search (sync, tool code):
  │      │   searchFn(topic, 5, resolvedEngines)
  │      │
  │      └─ Message 2: buildMergePrompt(topic, llmTopics, searchResults)
  │          → capture: plan JSON
  │
  ├─ 4. Validate plan, save artifact
  │
  └─ 5. TUI confirmation (confirmPlanDialog)
       → confirmed / cancelled
```

Agent calls ONCE. Tool blocks for 15-30 seconds. Returns confirmed plan or cancellation.

### Subprocess protocol

```typescript
// Same pattern as official subagent extension
const proc = spawn("pi", [
  "--mode", "json",
  "-p",              // print mode
  "--no-session",    // no session persistence
  "--model", ctx.model.provider + "/" + ctx.model.id,
], {
  cwd: ctx.cwd,
  stdio: ["pipe", "pipe", "pipe"],
});

// Send first prompt (introspection)
proc.stdin.write(introspectionPrompt + "\n");
proc.stdin.end();

// Parse JSONL stdout — capture the final assistant text
let output = "";
proc.stdout.on("data", (data) => {
  for (const line of data.toString().split("\n")) {
    const event = JSON.parse(line);
    if (event.type === "message_end" && event.message?.role === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") output += part.text;
      }
    }
  }
});

await new Promise(resolve => proc.on("close", resolve));
const llmTopics = output.trim();

// Merge search (tool code, no subprocess)
const mergeResults = await searchFn(topic, 5, engines);
const mergePrompt = buildMergePrompt(topic, llmTopics, mergeResults);

// Second prompt (plan creation) — same subprocess or new one
// New subprocess is simpler: each prompt is independent
const proc2 = spawn("pi", ...);
proc2.stdin.write(mergePrompt + "\n");
proc2.stdin.end();
// ... capture plan JSON
```

### What stays the same

- `prefilter-prompts.ts` — all prompt builders unchanged
- `confirmPlanDialog` — unchanged, runs in parent process
- `searchFn`, `scraper` — unchanged
- `PrefilterManager` — used for artifact saving and validation
- `run_research` — unchanged (ADR-0001 still applies)
- SKILL.md Phase 2-4 — unchanged

### What is removed

- Injection pattern from `plan_research` (`pi.sendUserMessage` for prefilter steps)
- `parseAgentResponse` and `extractJson` helpers
- Phase dispatch (awaiting_params / introspecting / merging)
- Agent turn-splitting confusion
- SKILL.md guardrail "Do NOT call plan_research again" — no longer needed
- SKILL.md Phase 1 multi-step protocol — collapses to: "Call `plan_research({ topic })`. Tool handles everything internally."

### Error handling

| Error | Recovery |
|-------|----------|
| Subprocess fails to start | Return error to agent |
| Subprocess returns invalid JSON | Retry with stricter prompt (max 3) |
| Subprocess returns unparseable plan | Return error with details |
| Search fails | Skip failed engines, continue with remaining |
| User cancels via Esc | Kill subprocess via `signal` |
| Subprocess times out | Kill after 60s, return error |

### Why ADR-0001's objection no longer applies

ADR-0001 rejected subprocess because:
1. **"Cannot reliably share Pi model with external process"** — subagent extension proves `--model` flag works. Active model resolves by `provider/id`.
2. **"Would duplicate LLM provider configuration"** — `pi` subprocess inherits auth from `~/.pi/agent/auth.json`. No duplication.
3. **"Loses Pi-native UI integration"** — TUI confirmation stays in parent process using `ctx.ui.select()`. Subprocess only handles what needs LLM reasoning.

### Why not direct LLM API

Pi SDK has no `complete()`/`stream()` method on `ExtensionContext`. Only `ctx.modelRegistry` (metadata) and `ctx.model` (active model info). Official `subagent` extension spawns a child process — this is the recommended pattern for LLM calls from within tool `execute()`.

## Consequences

- **ADR-0001** partially superseded: injection pattern remains for `run_research` only.
- **ADR-0027** simplified: single-call design stays, implementation switches from injection to subprocess.
- **One call, one response** — no agent confusion.
- **SKILL.md shrinks** — Phase 1 collapses to one sentence.
- **plan-research.ts shrinks** — ~200 → ~100 lines.
- **Token cost**: 2 subprocess LLM calls (~2000 tokens each) vs injection-based (~same or higher due to conversation context).
- **Latency**: 2 subprocess spawns + 2 search calls + 2 scrape calls = ~15-30 seconds.
- **Process overhead**: Spawning `pi` twice adds ~1-2 seconds per research. Acceptable.
- **Testability**: Mock `spawn` to test subprocess handling. Test prompt-output parsing without real LLM.

## Implementation steps (completed)

1. **Resolve engines/profile** from settings + defaults (no LLM)
2. **Spawn subprocess for introspection** — capture LLM topics, retry once on failure
3. **Merge search** — sync web search + scrape top pages
4. **Spawn subprocess for plan creation** — prompt includes schema template with real settings, retry on JSON failure
5. **Inject estimatedCost** — tool computes from profile params
6. **validateAndSavePlan** — JSON extraction (fences, bare, embedded) + validation + artifact save
7. **TUI confirmation** — unchanged confirmPlanDialog

Removed: `parseAgentResponse`, `extractJson`, phase dispatch, injections for prefilter, sessionManager.getEntries, params_json/plan_json parameters.
