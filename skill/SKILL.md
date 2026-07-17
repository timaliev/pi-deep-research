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

### Phase 1: Plan Research

Call `plan_research` once with the topic. The tool runs the entire prefilter pipeline automatically — no further `plan_research` calls needed. Respond to each injection prompt in your response text.

```
plan_research({ topic: "<user's research topic>" })
```

The tool will inject prompts for you to respond to in sequence:

1. **Engine/profile selection** — tool shows available engines and profiles. Respond with JSON: `{"engines": ["duckduckgo"], "profile": {"name": "default"}, "reportStyle": "narrative"}`.
   - **Engines:** `duckduckgo` (always available), `brave`, `tavily`, `yandex`, `searxng`. Only engines with configured API keys are shown as available.
   - **Profiles:** `default` (4/2/4 breadth/depth/concurrency), `fast` (2/1/2), `deep` (6/3/4), `custom` (specify numbers).
   - **Report styles:** `narrative` (fixed 5-section) or `subtopics` (5–7/8–12/12–20 topics depending on question count).

2. **LLM introspection** — tool asks you to propose topics from your internal knowledge. Respond with structured markdown listing topics with confidence/importance ratings.

3. **Merge & plan creation** — tool merges your topics with web search results and asks you to produce the final plan JSON:
   ```json
   {
     "topic": "...",
     "goal": "...",
     "researchQuestions": ["Q1"],
     "engines": ["duckduckgo"],
     "profile": {"name": "default"},
     "reportStyle": "narrative",
     "scope": {"include": "...", "exclude": "..."},
     "estimatedCost": {"searchCalls": 12, "scrapeCalls": 8, "description": "~12 searches"}
   }
   ```

4. **Confirmation** — tool validates the plan, saves it, and shows a TUI dialog:
   - ✅ Confirm — research proceeds to Phase 2
   - ✏️ Change parameters — edit engines, profile, or style in-place
   - ❌ Cancel — plan discarded

**Guardrail:** Do NOT call `plan_research` again with `params_json`, `plan_json`, or no parameters. The single `{ topic }` call drives the entire pipeline. Just respond to the injections. Errors are handled internally — the tool re-injects prompts or auto-advances. No agent action needed.

### Phase 2: Run Research

The TUI confirmation dialog appears automatically during `plan_research`. The result determines next step:

- **If user confirmed:** call `run_research`:
  ```
  run_research({ plan_artifact_path: "<path from plan_research result>" })
  ```
- **If user changed parameters:** the plan is updated in-place — call `run_research` with the same path.
- **If user cancelled:** the plan is discarded. Wait for a new topic.

Non-interactive mode is not supported — `plan_research` will return an error if no TUI is available.

### Phase 3: Research Loop

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

### Phase 4: Deliver

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
