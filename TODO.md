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
- TODO: save PDF-version of reports — designed in ADR-0014. Implement `export_pdf` tool with pandoc+weasyprint primary path and agent-injection fallback. Add `deepResearch.pdfExport` setting for auto-export after run.
- DONE: add profile name and parameters to Telemetry section of each report.
- DONE: use runid as file name for prefilter.log

### ADR-0013: Mind-map, MCP/local sources, repository link, profile listing

- TODO: implement standalone `mind_map` tool — injection-based, agent generates Mermaid `graph TD`, saves via `write`/`edit`.
- TODO: implement `mapping` phase in `ResearchRunOrchestrator` — gated by `deepResearch.mindMap` setting, injects findings-based prompt after `done`, captures agent response, appends `## Mind Map` to `draftReport`.
- TODO: add `deepResearch.mindMap` boolean setting (default `false`) to `SettingsContext`.
- TODO: rename `readExtensionVersion()` → `readExtensionMeta()` returning `{ version, repoUrl }` from `package.json`.
- TODO: add repository link row to Telemetry table in `buildTelemetrySection()`.
- TODO: add `Finding.source` field (`"web"` | `"local"` | `"mcp"`) to `Finding` interface.
- TODO: add optional `sources?: { local?: { paths: string[] }, mcp?: string[] }` to `ResearchPlan` interface.
- TODO: implement enriched search in `doSearching()` — `searchingEnriched` flag, inject MCP/local prompt after web search, capture raw agent response text, pass to extraction as unstructured context.
- TODO: extend `buildExtractionPrompt` with optional `localContext` and `mcpContext` params — per-source sections in prompt, machine-tags findings by source section.
- TODO: add source-type breakdown rows (Web/Local/MCP counts) to `buildTelemetrySection()`.
- TODO: add profile listing (all presets from `ProfileResolver.getPresets()` with breadth/depth/concurrency) to `buildPlanPrompt` in `PrefilterManager` step 3.
- TODO: update `buildParamsPrompt` and `buildPlanPrompt` to mention MCP/local sources in prefilter flow.

### ADR-0014: PDF export

- TODO: implement `export_pdf` tool — shell-out to pandoc+weasyprint, pre-flight checks (`which pandoc`, `which weasyprint`, `which mermaid-filter`), fallback to agent injection if tools missing.
- TODO: add `deepResearch.pdfExport` boolean setting (default `false`) to `SettingsContext`.
- TODO: implement auto-PDF export in `ResearchRunOrchestrator` — after `done` phase, check `pdfExport` setting, invoke conversion on report path.

### Known bugs (diagnosed 2026-07-02)

- TODO: **B1 (Medium)** — `research-run-orchestrator.ts:133` uses local `extractText()` which does NOT strip `<tool_calls>` XML blocks from agent response. The canonical `extractTextContent()` in `state-machine.ts` does strip them. Fix: replace `extractText` with `extractTextContent` import in orchestrator's `handleSubsequentCall` draft recovery path.
- TODO: **B2 (Low)** — `search/web-search.ts:331` creates `const parsedUrl = new URL(TAVILY_API_URL)` inside `tavilyPostRequest` but never uses it. Remove unused variable.

### Dead code (diagnosed 2026-07-02)

- TODO: **D1** — `state-machine.ts:454` `buildDraftingPrompt()` export marked `@deprecated`. Zero production callers. Safe to remove.
- TODO: **D2** — `search-providers.ts:7` `loadSearchProviders()` export. Zero production callers. `SettingsContext` handles provider loading now. Safe to remove or mark `@deprecated`.
- TODO: **D3** — `profile-resolver.ts:57` `loadDeepResearchSettings()` export. Zero production callers. `SettingsContext` handles settings loading now. Safe to remove or mark `@deprecated`.

### Code smells (low priority, diagnosed 2026-07-02)

- TODO: **S1** — `index.ts:145,162` `writeFileSync` imported twice via dynamic `await import("node:fs")` instead of module-level import. Consolidate into top-level import.
- TODO: **S2** — `index.ts:175-176` Module-level mutable `_prefilterManager` / `_prefilterRunId`. State bleeds if agent starts new research plan before finalizing previous one. Consider scoping by topic hash.
- TODO: **S3** — `index.ts:131,153` `reportsDir` declared 3 times (module-level + twice inside `save_report` execute). Shadowing is confusing but harmless.
- TODO: **S4** — `profile-resolver.ts:15` `resolveProfile()` marked `@deprecated` but actively used by `state-machine.ts` and `prefilter.ts` as legitimate fallback. Fix deprecation message or remove annotation.
- TODO: **S5** — `web-search.ts` ~600 lines. Engine implementations still live in this file while adapters re-export via `engines/*.ts`. Intentional per ADR-0009 but worth tracking for future extraction.

### Architecture improvements (from review 2026-07-02)

- TODO: **C1 (Strong)** — Deepen the Engine Adapter seam. Move each engine's implementation (DDG, Tavily, Yandex IAM+submit+poll+parse, Brave, SearXNG) from `web-search.ts` into its `engines/*.ts` adapter. Completes ADR-0009 migration. 500+ lines move, 10 exports removed from dispatcher.
- DONE: **C2 (Strong)** — Unify text extraction. Replace orchestrator's local `extractText()` with `extractTextContent()` import. Fixes bug B1 (XML leakage). One canonical text extraction module.
- TODO: **C3 (Worth exploring)** — Consolidate report saving. Merge `save_report` tool path logic with `assembleReport`. Single save seam, two callers (auto from orchestrator, manual from tool). Eliminates duplicate path computation.
- TODO: **C4 (Strong)** — Delete orphaned settings loaders. Remove `loadDeepResearchSettings` (profile-resolver.ts:57) and `loadSearchProviders` (search-providers.ts:7). Zero production callers since SettingsContext migration. Add `@deprecated` or delete.
- TODO: **C5 (Worth exploring)** — Scope PrefilterManager to Research Plan. Replace module-level mutable `_prefilterManager` / `_prefilterRunId` with session-entry-scoped state keyed by topic. Insurance against concurrent plans.
