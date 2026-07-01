---
name: deep-research
description: Autonomous deep web research. Plan research questions, search the web, scrape sources, extract findings, synthesize a structured markdown report. Use when the user asks for deep research, a web report, or to investigate a topic in depth.
---

# Deep Research

Run a multi-step autonomous web research workflow that produces a structured markdown report with cited sources.

## Setup

No setup required. DuckDuckGo is the default search engine (free, no API key). For higher quality results, configure API keys via environment variables or `~/.pi/agent/settings.json`:

| Engine | Key | Settings path | Free tier |
|--------|-----|---------------|-----------|
| `duckduckgo` | none | — | Unlimited |
| `brave` | `BRAVE_API_KEY` | `deepResearch.searchProviders.brave.apiKey` | 2,000/mo |
| `tavily` | `TAVILY_API_KEY` | `deepResearch.searchProviders.tavily.apiKey` | 1,000/mo |
| `yandex` | `YANDEX_OAUTH_TOKEN` + `YANDEX_FOLDER_ID` | `deepResearch.searchProviders.yandex.oauthToken` / `.folderId` | Pay-as-you-go |
| `searxng` | none | — | Variable (public instances) |

Environment variables take precedence over settings.json. Example settings.json:

```json
{
  "deepResearch": {
    "searchProviders": {
      "brave": { "apiKey": "BSA..." },
      "tavily": { "apiKey": "tvly-..." }
    }
  }
}
```

## Protocol

### Phase 1: Negotiate Parameters

1. Call `plan_research` with the user's topic:
   ```
   plan_research({ topic: "<user's research topic>" })
   ```
2. The tool responds with a prompt that includes **which API keys are currently available** (from env vars or settings.json). DuckDuckGo is always available. Propose only engines that have keys configured. Reply with JSON:
   ```json
   {"engines": ["duckduckgo"], "profile": {"name": "default"}, "reportStyle": "narrative"}
   ```
   **Engines:** `duckduckgo` (always available), `brave`, `tavily`, `yandex`, `searxng`.
   **Profiles:** `default` (4/2/4 breadth/depth/concurrency), `fast` (2/1/2), `deep` (6/3/4), `custom` (specify numbers).
   **Report styles:** `narrative` (fixed 5-section template: Introduction/Findings/Analysis/Recommendations/Sources) or `subtopics` (LLM discovers 5–10 thematic sections with subsections).

3. Call `plan_research` again with the params:
   ```
   plan_research({ topic: "<topic>", params_json: '<your params JSON>' })
   ```
4. **Guardrail:** If the result warns about missing API keys, tell the user to configure the key (env var or settings.json), then retry step 3.

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
     "reportStyle": "narrative",
     "scope": {"include": "What to include", "exclude": "What to exclude"},
     "estimatedCost": {"searchCalls": 12, "scrapeCalls": 8, "description": "~12 searches, ~8 scrapes"}
   }
   ```
   For custom profiles, include `breadth`, `depth`, `concurrency`: `{"name": "custom", "breadth": 5, "depth": 2}`.
   **Report styles:** `"narrative"` (fixed 5-section: Introduction/Findings/Analysis/Recommendations/Sources) or `"subtopics"` (LLM discovers 5–10 thematic sections from findings).

3. Call `plan_research` again with your plan. `topic` is optional when `plan_json` is provided (extracted from the plan):
   ```
   plan_research({ plan_json: "<your JSON>" })
   ```
4. **Guardrail:** If the result has `phase: "error"`, fix the JSON and retry.

### Phase 3: Confirm Cost

1. Call `estimate_research_cost`:
   ```
   estimate_research_cost({ plan_artifact_path: "<path from plan_research result>" })
   ```
2. Present to the user:
   - Topic and research questions
   - Chosen engines, profile, and report style
   - Estimated search/scrape counts
   - Ask: "Start deep research?"
3. **Guardrail:** Do NOT call `run_research` until the user explicitly confirms.
4. After user confirms, call `confirm_research`:
   ```
   confirm_research({ plan_artifact_path: "<path from plan_research result>" })
   ```
   `run_research` enforces this gate — it will reject unconfirmed plans.

### Phase 4: Research Loop

1. After confirmation, call `run_research`:
   ```
   run_research({ plan_artifact_path: "<path to prefilter.json>" })
   ```
2. **On EVERY subsequent call**, call `run_research` again with **no parameters**:
   ```
   run_research()
   ```
   **Guardrail:** Never pass `plan_artifact_path` on subsequent calls. The tool manages state internally — passing it would restart the research from scratch.
3. Between calls, process the injected prompt:
   - **Extraction:** Extract key findings from search results (cite sources). Then call `run_research()`.
   - **Questioning:** Generate **numbered** follow-up questions (e.g. `1. What is...?`). The state machine parses these to drive the next search iteration. Unnumbered responses fall back to the original plan questions. Then call `run_research()`.
   - **Drafting:** This is the only phase where you write text before calling the tool. Write the **complete** report as your response text. When finished, call `run_research()` (no parameters) **in the same response** — the tool reads your text and saves it.
4. Stop when `phase` is `"done"`. The tool auto-saves the report.

### Phase 5: Deliver

1. The report is auto-saved by `run_research`. The path is printed in the completion message.
2. Offer to show the report content.

## Output

| Artifact | Location | Format |
|---|---|---|
| Research plan | `{artifactsDir}/<runId>-prefilter.json` | JSON |
| Final report | `{reportsDir}/YYYY-MM-DD-topic-slug.md` | Markdown |
| Research log | `{artifactsDir}/../logs/<runId>.log` | JSONL trace |
| Search queue | `{artifactsDir}/queue-<runId>-d<depth>.json` | JSON (post-mortem) |

Default paths: `./deep-research/artifacts/`, `./deep-research/reports/`. Override via `deepResearch.artifactsDir` and `deepResearch.reportsDir` in settings.json.

## Error Recovery

- **Missing API key:** During prefilter, if you select an engine without its key configured (env var or settings.json), the tool warns you. Tell the user to set it and retry.
- **Search fails:** The tool skips failed engines and continues. At runtime, if a configured engine has no key, it silently falls back to duckduckgo (logged).
- **Scrape fails:** The tool skips failed scrapes. Findings use search snippets only.
- **State lost:** If you see "no research state found", start over from Phase 1.
- **Rate limiting:** Built-in exponential backoff with jitter handles DuckDuckGo rate limits automatically. No manual retry needed.
