# Project to do list

Note to agent: after each item is implemented and tested change `TODO:` into `DONE:`.

- DONE: use `deepResearch.searchProviders` field from settings.json to find API keys and other parameters for search engines.
- DONE: Write extension version from `./package.json` into each report statistics.
- DONE: if `plan.engines` contains more then one entry, distribute search requests evenly between those search engines.
- DONE: before running any web search requests build a queue of such a requests (each with random delay between sequential request if it is DDG or any other free engine) and then run them respecting delay. Keep queue as a JSON-file in `artifacts` directory for later post-mortem analysis.
- DONE: ensure that `## Research Telemetry` section is appended to each report at the end of file.
- DONE: include all artifacts files pertaining to the report as reference links in `## Research Telemetry` section of each report.
- DONE: read `https://api-dashboard.search.brave.com/app/documentation/web-search/get-started` and implement `brave` web search accordingly.
- DONE: add GitHub workflow for release, so only after successful tests pass release can be created.
- DONE: save PDF-version of reports — designed in ADR-0014. Implement `export_pdf` tool with pandoc+weasyprint primary path and agent-injection fallback. Add `deepResearch.pdfExport` setting for auto-export after run.
- DONE: add profile name and parameters to Telemetry section of each report.
- DONE: use runid as file name for prefilter.log

### ADR-0013: Mind-map, MCP/local sources, repository link, profile listing

- DONE: implement standalone `mind_map` tool — injection-based, agent generates Mermaid `graph TD`, saves via `write`/`edit`.
- DONE: implement `mapping` phase in `ResearchRunOrchestrator` — gated by `deepResearch.mindMap` setting, injects findings-based prompt after `done`, captures agent response, appends `## Mind Map` to `draftReport`.
- DONE: add `deepResearch.mindMap` boolean setting (default `false`) to `SettingsContext`.
- DONE: rename `readExtensionVersion()` → `readExtensionMeta()` returning `{ version, repoUrl }` from `package.json`.
- DONE: add repository link row to Telemetry table in `buildTelemetrySection()`.
- TODO: add `Finding.source` field (`"web"` | `"local"` | `"mcp"`) to `Finding` interface.
- TODO: add optional `sources?: { local?: { paths: string[] }, mcp?: string[] }` to `ResearchPlan` interface.
- TODO: implement enriched search in `doSearching()` — `searchingEnriched` flag, inject MCP/local prompt after web search, capture raw agent response text, pass to extraction as unstructured context.
- TODO: extend `buildExtractionPrompt` with optional `localContext` and `mcpContext` params — per-source sections in prompt, machine-tags findings by source section.
- TODO: add source-type breakdown rows (Web/Local/MCP counts) to `buildTelemetrySection()`.
- DONE: add profile listing (all presets from `ProfileResolver.getPresets()` with breadth/depth/concurrency) to `buildPlanPrompt` in `PrefilterManager` step 3.
- TODO: update `buildParamsPrompt` and `buildPlanPrompt` to mention MCP/local sources in prefilter flow.

### ADR-0014: PDF export

- DONE: implement `export_pdf` tool — shell-out to pandoc+weasyprint, pre-flight checks (`which pandoc`, `which weasyprint`, `which mermaid-filter`), fallback to agent injection if tools missing.
- DONE: add `deepResearch.pdfExport` boolean setting (default `false`) to `SettingsContext`.
- DONE: implement auto-PDF export in `ResearchRunOrchestrator` — after `done` phase, check `pdfExport` setting, invoke conversion on report path.

### Known bugs (diagnosed 2026-07-02)

- DONE: **B1 (Medium)** — `research-run-orchestrator.ts` uses `extractTextContent()` from state-machine.ts, stripping `<tool_calls>` XML blocks. Fixed.
- DONE: **B2 (Low)** — unused `parsedUrl` variable removed during tavily adapter extraction (C1).

### Dead code (diagnosed 2026-07-02)

- DONE: **D1** — `buildDraftingPrompt()` removed in C4 refactor.
- DONE: **D2** — `loadSearchProviders()` removed in C4 refactor.
- DONE: **D3** — `loadDeepResearchSettings()` removed in C4 refactor.

### Code smells (low priority, diagnosed 2026-07-02)

- DONE: **S2** — Module-level `_prefilterManager` replaced with Map keyed by runId (C5).
- DONE: **S3** — `reportsDir` shadowing removed in C3.
- DONE: **S4** — `resolveProfile()` deprecation annotation cleaned up in C2.
- DONE: **S5** — Engine implementations extracted to `engines/*.ts` adapters (C1).

### Architecture improvements (from review 2026-07-02)

- DONE: **C1** — Engine Adapter seam deepened.
- DONE: **C2** — Text extraction unified with `extractTextContent()`.
- DONE: **C3** — Report path consolidated with `resolveReportPath()`.
- DONE: **C4** — Orphaned setting loaders deleted.
- DONE: **C5** — PrefilterManager scoped to Map keyed by runId, concurrent plans safe.

### Configurable default report style (designed 2026-07-07, implemented 2026-07-09)

- DONE: add `reportStyle` field to `SettingsContext` — cascade: env `DEEP_RESEARCH_REPORT_STYLE` → local settings.json `deepResearch.defaultReportStyle` → global settings.json → `"narrative"`.
- DONE: add `defaultReportStyle` field to `ResearchContext` interface and `ResearchStateMachine` constructor.
- DONE: update `state-machine.ts` fallback: `plan.reportStyle ?? this.defaultReportStyle ?? "narrative"` (4 call sites).
- DONE: wire `settings.reportStyle` through `index.ts` → `ResearchRunOrchestrator` → `ResearchStateMachine`.
- DONE: update `prefilter.ts` prompt — show configured default marked with `(default)`, instruct LLM to advise narrative vs subtopics based on topic complexity.
- DONE: add `"reportStyle"` to `buildParamsPrompt` expected JSON template.
- DONE: add tests for settings cascade, env override, state machine fallback, prefilter prompt advisory.
