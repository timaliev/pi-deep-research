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
   **Report styles:** `narrative` (fixed 5-section template: Introduction/Findings/Analysis/Recommendations/Sources) or `subtopics` (LLM discovers thematic sections: 5–7 for ≤4 questions, 8–12 for 5–7, 12–20 for 8+).

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
   **Report styles:** `"narrative"` (fixed 5-section: Introduction/Findings/Analysis/Recommendations/Sources) or `"subtopics"` (LLM discovers thematic sections: 5–7 for ≤4 questions, 8–12 for 5–7, 12–20 for 8+).

3. Call `plan_research` again with your plan. `topic` is optional when `plan_json` is provided (extracted from the plan):
   ```
   plan_research({ plan_json: "<your JSON>" })
   ```
4. **Guardrail:** If the result has `phase: "error"`, fix the JSON and retry.

### Phase 3: Confirm Cost

**Guardrail:** Read the plan_research result carefully before proceeding.

- **If the result says "Research confirmed"** (▶ Research confirmed): skip directly to Phase 4. Do NOT call estimate_research_cost or confirm_research.
- **If the result says "Research not confirmed"** (⏸ Research not confirmed): **STOP here.** Do NOT call any tools. The user declined. Wait for the user to modify the plan parameters or manually call confirm_research.
- **If neither message appears** (non-interactive mode): use the manual flow below.

**Manual flow (non-interactive only):**

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
4. After user confirms, call `confirm_research`. The TUI will show a confirmation dialog with plan details — the user must pick "Yes — Start research" in the terminal before the tool executes.
   ```
   confirm_research({ plan_artifact_path: "<path from plan_research result>" })
   ```
   `run_research` enforces this gate — it will reject unconfirmed plans. In non-interactive mode (print/CI), confirmation is blocked.

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
   **Auto-loop:** Do NOT ask the user whether to continue at each depth. The research profile already defines depth — the agent must call `run_research` automatically until `phase` is `"done"`. The user approved the plan and cost in Phase 3; no further confirmation is needed.*
3. Between calls, process the injected prompt:
   - **Extraction:** Extract key findings from search results (cite sources). Then call `run_research()`.
   - **Questioning:** Generate **numbered** follow-up questions (e.g. `1. What is...?`). The state machine parses these to drive the next search iteration. Unnumbered responses fall back to the original plan questions. Then call `run_research()`.
   - **Drafting:** This is the only phase where you write text before calling the tool. Write the **complete** report as your response text. When finished, call `run_research()` (no parameters) **in the same response** — the tool reads your text and saves it.
4. Stop when `phase` is `"done"`. The tool auto-saves the report.

### Phase 5: Deliver

1. The report is auto-saved by `run_research` and the path is printed in the completion message.
2. To re-save or deliver the report, call `save_report` with the report path (not the full content — use `report_path` for large reports):
   ```
   save_report({ topic: "Research Topic", report_path: "<path from run_research>" })
   ```
3. Offer to export PDF or generate a mind map on demand.

## Output

| Artifact | Location | Format |
|---|---|---|
| Research plan | `{artifactsDir}/<runId>-prefilter.json` | JSON |
| Final report | `{reportsDir}/YYYY-MM-DD-topic-slug.md` | Markdown |
| Research log | `{artifactsDir}/../logs/<runId>.log` | JSONL trace |
| Search queue | `{artifactsDir}/queue-<runId>-d<depth>.json` | JSON (post-mortem) |

Default paths: `./deep-research/artifacts/`, `./deep-research/reports/`. Override via `deepResearch.artifactsDir` and `deepResearch.reportsDir` in settings.json.

## PDF Export

Export any research report to PDF via the `export_pdf` tool:

```
export_pdf({ report_path: "deep-research/reports/my-report.md" })
```

PDF saved to same directory as the report with `.pdf` extension. Override with `output_path`:

```
export_pdf({ report_path: "deep-research/reports/my-report.md", output_path: "exports/report.pdf" })
```

**Auto-export:** Enable `deepResearch.pdfExport: true` in settings.json (or `DEEP_RESEARCH_PDF_EXPORT=true` env var). The report is automatically converted to PDF after each run. On failure (missing pandoc), a hint is shown in the completion message — call `export_pdf` to retry.

**System requirements for direct conversion:**
- `pandoc` + `weasyprint` must be installed on the system
- If missing, the agent receives a fallback prompt to convert via browser print-to-PDF
- `mermaid-filter` (optional, `npm install -g mermaid-filter`) enables Mermaid diagram rendering in PDF

**Platform setup:**
- **macOS:** `brew install pandoc` + `pip3 install weasyprint`
- **Linux:** `sudo apt install pandoc` + `pip install weasyprint`
- **Windows:** `winget install pandoc` + `pip install weasyprint`

## Mind Map

Generate Mermaid mind map diagrams via `mind_map` tool:

```
mind_map({ topic: "Research Topic", content: "..." })
```

Agent responds with a ` ```mermaid ` block containing `graph TD` diagram. Optionally save to file:

```
mind_map({ topic: "Topic", content: "...", save_path: "diagram.mmd" })
```

**Auto-generate:** Enable `deepResearch.mindMap: true` in settings.json (or `DEEP_RESEARCH_MIND_MAP=true`). After each research run, a mind map is generated from key findings and appended to the report as `## Mind Map`.

No system dependencies — diagram generated by the LLM.

## Error Recovery

- **Missing API key:** During prefilter, if you select an engine without its key configured (env var or settings.json), the tool warns you. Tell the user to set it and retry.
- **Search fails:** The tool skips failed engines and continues. At runtime, if a configured engine has no key, it silently falls back to duckduckgo (logged).
- **Scrape fails:** The tool skips failed scrapes. Findings use search snippets only.
- **State lost:** If you see "no research state found", start over from Phase 1.
- **Rate limiting:** Built-in exponential backoff with jitter handles DuckDuckGo rate limits automatically. No manual retry needed.
