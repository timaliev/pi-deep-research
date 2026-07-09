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

### ADR-0018: Release monitor on session start (designed 2026-07-09)

- TODO: create `extension/release-monitor.ts` — checkForNewRelease(sendUserMessage) with 6-hour cooldown.
- TODO: wire `pi.on("session_start", ...)` in `extension/index.ts`.
- TODO: GitHub API call `GET /repos/timaliev/pi-deep-research/releases/latest`, unauthenticated.
- TODO: version comparison — GitHub `tag_name` vs local `package.json` `version`.
- TODO: notify via `pi.sendUserMessage()` only if newer version exists.

### SearxNG custom instance

- TODO: add `searxng: { url: "SEARXNG_URL" }` to `SearchProviderCredentials.ENV_MAP`.
- TODO: read `cred?.get("searxng", "url")` in searxng adapter to prepend custom URL to instance list.
- TODO: custom instance has no fallback to public instances (privacy).

### ADR-0017: LLM introspection + source-tagged questions (designed 2026-07-09)

- TODO: add `introspectionDone` flag and LLM introspection substate to `PrefilterManager` / `PrefilterSession`.
- TODO: add LLM introspection injection prompt to `prefilter-prompts.ts` — agent proposes topics from internal knowledge with confidence/importance.
- TODO: add merge injection prompt to `prefilter-prompts.ts` — merge LLM topics with web search results, tag sources, flag contradictions.
- TODO: extend `plan_research` tool to dispatch introspection turn (Turn 1: with params_json → inject introspection; Turn 2: no params → run search + inject merge).
- TODO: add `questionMetadata?: Record<string, {source, confidence, importance, contradictionOf?, debatableFact?}>` to ResearchPlan.
- TODO: extend subtopics drafting prompt topic tiers: 0-4q → 5-7, 5-7q → 8-12, 8+q → 12-20.
- TODO: add post-report contradiction analysis in `ResearchRunOrchestrator` — gated by presence of contradiction flags, inject analysis prompt, append `## Contradictions & Debatable Facts` to report.
- FUTURE: Question 8 — runtime consumption of questionMetadata (priority ordering, prompt enrichment based on confidence).

### Default report style (implemented 2026-07-09)

- DONE: add `reportStyle` field to `SettingsContext` — cascade: env `DEEP_RESEARCH_REPORT_STYLE` → local settings.json `deepResearch.defaultReportStyle` → global settings.json → `"narrative"`.
- DONE: add `defaultReportStyle` field to `ResearchContext` interface and `ResearchStateMachine` constructor.
- DONE: update `state-machine.ts` fallback: `plan.reportStyle ?? this.defaultReportStyle ?? "narrative"` (4 call sites).
- DONE: wire `settings.reportStyle` through `index.ts` → `ResearchRunOrchestrator` → `ResearchStateMachine`.
- DONE: update `prefilter.ts` prompt — show configured default marked with `(default)`, instruct LLM to advise narrative vs subtopics based on topic complexity.
- DONE: add `"reportStyle"` to `buildParamsPrompt` expected JSON template.
- DONE: add tests for settings cascade, env override, state machine fallback, prefilter prompt advisory.
