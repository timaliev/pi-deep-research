---
name: deep-research
description: Autonomous deep web research. Plan research questions, search the web, scrape sources, extract findings, synthesize a structured markdown report. Use when the user asks for deep research, a web report, or to investigate a topic in depth.
---

# Deep Research

Run a multi-step autonomous web research workflow that produces a structured markdown report with cited sources.

## Setup

No setup required. DuckDuckGo is the default search engine (free, no API key). For higher quality results, configure API keys via environment variables or `<cwd>/.pi/settings.json` or `~/.pi/agent/settings.json`:

| Engine | Key | Settings path | Free tier |
|--------|-----|---------------|-----------|
| `duckduckgo` | none | — | Unlimited |
| `brave` | `BRAVE_API_KEY` | `deepResearch.searchProviders.brave.apiKey` | 2,000/mo |
| `tavily` | `TAVILY_API_KEY` | `deepResearch.searchProviders.tavily.apiKey` | 1,000/mo |
| `yandex` | `YANDEX_OAUTH_TOKEN` + `YANDEX_FOLDER_ID` | `deepResearch.searchProviders.yandex.oauthToken` / `.folderId` | Pay-as-you-go |
| `searxng` | none | — | Variable (public instances) |

Environment variables take precedence over settings.json. Local settings.json take precedence over global settings.json. Example settings.json:

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
4. **Guardrail:** If the result warns about missing API keys, tell the user to configure the key (env var or settings.json), then retry step 3 without search engine that have missing API keys.

### Phase 2: Plan Research

1. The tool runs a preliminary search with your chosen engines and sends you a prompt with results.
2. **Guardrail:** The tool now requires the full prefilter flow. You must complete ALL steps below — direct plan_json submission without the prior steps will be rejected with an error.
3. Call `plan_research` with no parameters to start LLM introspection. The tool will ask you to propose topics from your internal knowledge. Respond with structured markdown listing topics with confidence/importance ratings.
   ```
   plan_research()
   ```
4. Call `plan_research` again with no parameters. The tool will merge your topics with web search results and ask you to produce the final plan. Analyze the merged results and produce a JSON research plan:
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

5. Call `plan_research` again with your plan. `topic` is optional when `plan_json` is provided (extracted from the plan):
   ```
   plan_research({ plan_json: "<your JSON>" })
   ```
6. **Guardrail:** If the result has `phase: "error"`, fix the JSON and retry. If the error says "without running the full prefilter flow", you skipped steps 3-4 — go back and complete them.

### Phase 3: Confirm Plan

**The TUI dialog appears automatically after plan_research.** No agent calls needed.

- **If the user picks ✅ Confirm:** the tool returns "Research confirmed." Proceed directly to Phase 4. Do NOT call estimate_research_cost or confirm_research.
- **If the user picks ✏️ Change parameters:** the TUI enters a multi-step parameter editor (engines, profile, report style). The plan is updated in-place — no LLM involvement. After changes, the user returns to the confirm/cancel dialog.
- **If the user picks ❌ Cancel:** the plan is discarded. The tool returns "Plan cancelled." Wait for the user to start a new topic.

**Standalone confirm_research tool** is available for re-confirmation of previously saved plans. It opens the same TUI dialog.

**Non-interactive mode (print/CI):** The TUI is not available. Call `estimate_research_cost` to present the plan to the user, ask for confirmation, then call `confirm_research`.

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
