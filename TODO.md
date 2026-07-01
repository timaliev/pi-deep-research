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
