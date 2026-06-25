---
name: deep-research
description: Autonomous deep web research. Plan research questions, search the web, scrape sources, extract findings, synthesize a structured markdown report. Use when the user asks for deep research, a web report, or to investigate a topic in depth.
---

# Deep Research

Run a multi-step autonomous web research workflow that produces a structured markdown report with cited sources.

## Setup

No setup required. DuckDuckGo is the default search engine (free, no API key). For higher quality results, set environment variables:

- `BRAVE_API_KEY` — [Brave Search API](https://brave.com/search/api/) (free tier: 2,000 queries/month)
- SearXNG uses public instances, no key needed (may be unreliable)

## Protocol

### Phase 1: Negotiate Parameters

1. Call `plan_research` with the user's topic:
   ```
   plan_research({ topic: "<user's research topic>" })
   ```
2. The tool sends a prompt asking you to propose search engines and a research profile. Reply with JSON:
   ```json
   {"engines": ["duckduckgo"], "profile": {"name": "default"}}
   ```
   **Engines:** `duckduckgo` (always available), `brave` (needs `BRAVE_API_KEY`), `searxng`.
   **Profiles:** `default` (4/2/4 breadth/depth/concurrency), `fast` (2/1/2), `deep` (6/3/4), `custom` (specify numbers).

3. Call `plan_research` again with the params:
   ```
   plan_research({ topic: "<topic>", params_json: '<your params JSON>' })
   ```
4. **Guardrail:** If the result warns about missing API keys, tell the user to set the env var, then retry step 3.

### Phase 2: Plan Research

1. The tool runs a preliminary search with your chosen engines and sends you a prompt with results.
2. Analyze the results and produce a JSON research plan:
   ```json
   {
     "topic": "The research topic",
     "goal": "What this research aims to achieve",
     "researchQuestions": ["Question 1", "Question 2", "Question 3"],
     "engines": ["duckduckgo"],
     "profile": {"name": "default"},
     "scope": {"include": "What to include", "exclude": "What to exclude"},
     "estimatedCost": {"searchCalls": 12, "scrapeCalls": 8, "description": "~12 searches, ~8 scrapes"}
   }
   ```
   For custom profiles, include `breadth`, `depth`, `concurrency`: `{"name": "custom", "breadth": 5, "depth": 2}`.

3. Call `plan_research` again with your plan:
   ```
   plan_research({ topic: "<topic>", plan_json: "<your JSON>" })
   ```
4. **Guardrail:** If the result has `phase: "error"`, fix the JSON and retry.

### Phase 3: Confirm Cost

1. Call `estimate_research_cost`:
   ```
   estimate_research_cost({ plan_artifact_path: "<path from plan_research result>" })
   ```
2. Present to the user:
   - Topic and research questions
   - Chosen engines and profile
   - Estimated search/scrape counts
   - Ask: "Start deep research?"
3. **Guardrail:** Do NOT call `run_research` until the user explicitly confirms.

### Phase 4: Research Loop

1. After user confirmation, call `run_research`:
   ```
   run_research({ plan_artifact_path: "<path to prefilter.json>" })
   ```
2. **Guardrail:** After EVERY `run_research` response, call `run_research` again immediately with NO parameters. The tool manages its own state machine.
3. Between calls, process the injected prompt:
   - Extract findings from search results
   - Generate follow-up questions
   - Write draft report
4. Stop when `phase` is `"done"`.

### Phase 5: Deliver

1. Report the saved report path to the user.
2. Offer to show the report content.

## Output

| Artifact | Location | Format |
|---|---|---|
| Research plan | `./deep-research/artifacts/<runId>-prefilter.json` | JSON |
| Final report | `./deep-research/reports/YYYY-MM-DD-topic-slug.md` | Markdown |
| Research log | `./deep-research/logs/<runId>.log` | JSONL trace |

## Error Recovery

- **Missing API key:** During prefilter, if you select `brave` without `BRAVE_API_KEY` set, the tool warns you. Tell the user to set it and retry.
- **Search fails:** The tool skips failed engines and continues. At runtime, if a configured engine has no key, it silently falls back to duckduckgo (logged).
- **Scrape fails:** The tool skips failed scrapes. Findings use search snippets only.
- **State lost:** If you see "no research state found", start over from Phase 1.
- **Rate limiting:** Built-in exponential backoff with jitter handles DuckDuckGo rate limits automatically. No manual retry needed.
