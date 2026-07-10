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

### Architecture improvements (from review 2026-07-09)

- DONE: Delete utils.ts pass-through module — engines import waitIfNeeded directly from web-search.js.
- DONE: Remove redundant dual waitIfNeeded calls — searchAllEngines no longer calls waitIfNeeded.
- DONE: Extract RateLimiter module — single seam for all rate-limiting (waitIfNeeded, retryOnRateLimit, recordCall).
- DONE: De-duplicate artifact-not-found guard — readPlanArtifact() in shared.ts.
- DONE: Consolidate tool factory dependency injection — ToolDeps + registerAllTools(pi, deps).
- DONE: Extract prompt builders from prefilter.ts — prefilter-prompts.ts pure functions.
- DONE: Fix brave engine waitIfNeeded error (jiti circular dep via utils.ts).

### Remaining (ADR-0013: MCP/local sources)

- TODO: add `Finding.source` field (`"web"` | `"local"` | `"mcp"`) to `Finding` interface.
- TODO: add optional `sources?: { local?: { paths: string[] }, mcp?: string[] }` to `ResearchPlan` interface.
- TODO: implement enriched search in `doSearching()` — `searchingEnriched` flag, inject MCP/local prompt after web search, capture raw agent response text, pass to extraction as unstructured context.
- TODO: extend `buildExtractionPrompt` with optional `localContext` and `mcpContext` params — per-source sections in prompt, machine-tags findings by source section.
- TODO: add source-type breakdown rows (Web/Local/MCP counts) to `buildTelemetrySection()`.
- TODO: update `buildParamsPrompt` and `buildPlanPrompt` to mention MCP/local sources in prefilter flow.

### ADR-0018: Release monitor on session start (implemented 2026-07-10)

- DONE: create `extension/release-monitor.ts` — checkForNewRelease(sendUserMessage) with 6-hour cooldown.
- DONE: wire `pi.on("session_start", ...)` in `extension/index.ts`.
- DONE: GitHub API call `GET /repos/timaliev/pi-deep-research/releases/latest`, unauthenticated.
- DONE: version comparison — GitHub `tag_name` vs local `package.json` `version`.
- DONE: notify via `pi.sendUserMessage()` only if newer version exists.

### ADR-0019: TUI confirmation gate (implemented 2026-07-10)

- DONE: intercept `confirm_research` via `pi.on("tool_call", ...)` in `extension/index.ts`.
- DONE: read plan artifact, show TUI binary choice with plan details.
- DONE: block in non-interactive mode (ctx.hasUI check).
- DONE: return `{ block: true }` when user declines.

### ADR-0020: SettingsContext re-init on session_start (implemented 2026-07-10)

- DONE: add `reinit(cwd)` method — re-applies cascade with new working directory.
- DONE: make fields mutable, extract `compute(cwd)` helper.
- DONE: wire `pi.on("session_start", ...)` in `extension/index.ts`.
- DONE: wire SettingsContext into `export_pdf` and `mind_map` tools for default output paths.

### ADR-0021: save_report with report_path (implemented 2026-07-09)

- DONE: add optional `report_path` parameter to `save_report` tool.
- DONE: read content from disk when `report_path` provided.
- DONE: markdown made optional (backward-compatible).

### ADR-0022: Remove done-phase steer messages (implemented 2026-07-10)

- DONE: replace `pi.sendUserMessage()` PDF fallback with inline `💡` hint.
- DONE: replace `pi.sendUserMessage()` mind-map prompt with inline `💡` hint.

### ADR-0023: Settings report — provenance tracking (implemented 2026-07-10)

- DONE: add `*Source` provenance fields to SettingsContext + `settingsReport` group (onSessionStart, onRunStart, inReport).
- DONE: add `getAllWithSources()` to SettingsContext.
- DONE: create `extension/settings-reporter.ts` — buildSettingsTable, buildSettingsJson, writeSettingsLog, appendSettingsSection.
- DONE: wire session_start — always log, inject table if onSessionStart.
- DONE: wire plan_research step 1 — always log, inject table if onRunStart.
- DONE: wire orchestrator buildDoneResult — append ## Settings if inReport.
- DONE: add ADR, README settings docs, CONTEXT.md terms.

### Architecture improvements (from review 2026-07-09)

- DONE: Delete utils.ts pass-through module.
- DONE: Remove redundant dual waitIfNeeded calls.
- DONE: Extract RateLimiter module.
- DONE: De-duplicate artifact-not-found guard.
- DONE: Consolidate tool factory dependency injection.
- DONE: Extract prompt builders from prefilter.ts.
- DONE: Fix brave engine waitIfNeeded error.

### SearXNG custom instance

- TODO: add `searxng: { url: "SEARXNG_URL" }` to settings + env cascade.
- TODO: read URL in searxng adapter to prepend custom instance before public fallbacks.
- TODO: custom instance has no fallback to public instances (privacy).

### Engine allowlist (implemented 2026-07-10)

- DONE: add `enabledEngines` field to `SettingsContext` — env `DEEP_RESEARCH_ENABLED_ENGINES` or `deepResearch.enabledEngines` in settings.json. Default: ["duckduckgo", "searxng"].
- DONE: update `buildEngineStatus()` to filter by allowlist.
- TODO: has key but not in allowlist → ❌ "not enabled" (new distinct label).

### ADR-0017: LLM introspection (implemented 2026-07-10)

- DONE: add `introspectionDone` flag to `PrefilterManager`.
- DONE: add `buildIntrospectionPrompt` to `prefilter-prompts.ts`.
- DONE: add `buildMergePrompt` to `prefilter-prompts.ts`.
- DONE: extend `plan_research` to dispatch introspection turn.
- DONE: add `questionMetadata` to `ResearchPlan`.
- DONE: extend subtopics drafting prompt tiers: 0-4 → 5-7, 5-7 → 8-12, 8+ → 12-20.
- DONE: add contradiction analysis to `ResearchRunOrchestrator`.
- FUTURE: Question 8 — runtime consumption of questionMetadata.

### Architecture review 4 (2026-07-09)

- DONE: post-processing pipeline — `PostProcessor` interface, adapters for assemble/PdfExport/mindMap (2026-07-10).
- DONE: plan_research dispatch — extract `execute()` into 4 handler methods (2026-07-10).
- DONE: orchestrator run-and-persist — deduplicate `handleFirstCall`/`handleSubsequentCall` (2026-07-10).

### Dead code / stubs

- DONE: `saveReportPath` dead telemetry param removed (2026-07-10).
