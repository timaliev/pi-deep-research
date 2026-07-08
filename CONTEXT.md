# Deep Research for Pi

A Pi extension and skill that provides autonomous deep web research — planning research questions, searching the web, scraping sources, extracting findings, and synthesizing a structured markdown report — all using the user's current Pi LLM model.

## Language

**Deep Research**:
An autonomous multi-step research workflow: plan research questions → search → scrape → extract findings → recurse for depth → synthesize final report. Activated when the user asks Pi to research a topic, collect a web report with sources, or generate a markdown research report.
_Avoid_: web search, web report (these are individual steps, not the whole workflow)

**Prefilter**:
The initial planning phase with three steps: (1) agent proposes search engines and research profile, (2) preliminary web search runs with chosen engines, (3) agent produces a full Research Plan (JSON). Does not produce the final report. Corresponds to `plan_research` tool. If API keys are missing for chosen engines, loops back to step 1 with a warning.
_Avoid_: planning, plan generation, query pre-processing

**Research Plan**:
A JSON artifact produced by `plan_research` containing: topic, goal, research questions (array), engines (array of search engine names), profile (named preset or custom with breadth/depth/concurrency), scope (include/exclude), and estimated cost breakdown. Stored as `prefilter.json` in `./deep-research/artifacts/`. Serves as the canonical input for `run_research`. All runtime parameters (engines, depth, breadth) are locked in the plan — no overrides at run time.
_Avoid_: plan document, research brief, query template

**Research Run**:
A single execution of the `run_research` state machine from plan to report. Has a unique `runId` (timestamp-based) and produces artifacts: report, telemetry, log. Multiple runs can use the same Research Plan.
_Avoid_: execution, workflow run, research job

**Phase**:
A discrete state inside the `run_research` or `plan_research` state machine. The tool advances through phases (`searching → extracting → questioning → drafting → saving → done`) across multiple invocations, driven by the agent calling the tool repeatedly. Each invocation may advance one or more phases.
_Avoid_: step, stage, iteration

**Injection**:
A message sent by the extension tool into the Pi agent conversation via `pi.sendUserMessage()`, containing a prompt that asks the agent to perform a reasoning step (e.g., "Extract findings from this content", "Generate follow-up questions"). The tool cannot call the LLM directly — it must inject prompts and wait for the agent to respond in the next turn.
_Avoid_: prompt injection, steer message, follow-up prompt

**Finding**:
A single extracted insight from scraped web content, comprising the insight text, a source URL, a citation quote, and the iteration number in which it was discovered. Findings accumulate across all depth iterations and feed into the final report.
_Avoid_: learning, fact, observation, note

**Iteration**:
One level of the recursive research depth. Each iteration: search N queries (breadth) → scrape top results → extract findings → generate follow-up questions for the next iteration. The number of iterations is controlled by the `depth` parameter in the Research Profile.
_Avoid_: level, recursion step, pass

**Research Profile**:
A named preset or custom configuration controlling research budget: `breadth` (queries per level), `depth` (recursion levels), `concurrency` (parallel searches). Presets: `default` (4/2/4), `fast` (2/1/2), `deep` (6/3/4). Custom profiles specify exact numbers. Negotiated during prefilter and stored in the Research Plan. Built-in presets may be overridden or extended in `~/.pi/agent/settings.json` under `deepResearch.profiles` (merged, user wins). Default profile name can be changed via `deepResearch.defaultProfile`.
_Avoid_: config preset, run configuration, research mode

**ProfileResolver**:
Unified module (extension/profile-resolver.ts) that loads user settings from `~/.pi/agent/settings.json`, merges them with built-in presets, and provides a single `resolve(profile)` interface for all tools. Replaces the scattered `resolveProfile` + `DEFAULT_PRESETS` pattern across the codebase.
_Avoid_: profile manager, config loader

**Search Engine**:
A web search backend used by all research tools. The extension uses a unified `searchWeb()` function supporting duckduckgo (free, zero-config, with retry/backoff), brave (needs `BRAVE_API_KEY` env var), and searxng (public instances). Selected during prefilter and stored in the Research Plan. DuckDuckGo is the default and always available; other engines require environment variables.
_Avoid_: retriever, search backend, search provider

**SearchProviderCredentials**:
Class inside SettingsContext (extension/settings-context.ts) resolving API keys for search engines. Uses process.env override over settings.json. Used by prefilter checkApiKeys and search functions.
_Avoid_: API key resolver, credential manager

**SettingsContext**:
Unified singleton module (extension/settings-context.ts) that loads all settings once with a uniform priority cascade: env vars -> <cwd>/.pi/settings.json -> ~/.pi/agent/settings.json -> built-in defaults. Exposes flat fields: reportsDir, artifactsDir, defaultProfile, profiles (merged), credentials (SearchProviderCredentials). Replaces scattered loadDeepResearchSettings() + loadSearchProviders(). ProfileResolver built from it, not embedded.
_Avoid_: config, configuration loader, settings manager
**ResearchContext**:
A bundled object passed to `ResearchStateMachine` constructor, replacing 6 positional parameters. Contains `searchFn`, `scraper`, and optional `profilePresets`, `logger`, `artifactsDir`, `searchCred`. Allows adding new dependencies without touching all call sites.
_Avoid_: constructor options, DI container

**SessionState**:
Module (extension/session-state.ts) consolidating persistence of research state, report path, and confirmation markers via `pi.appendEntry`. Exposes typed methods (`saveResearchState`, `saveReportPath`, `saveConfirmation`, `restoreDraft`) behind a single seam. Wired into index.ts, replacing scattered key constants and draft restore logic.
_Avoid_: state manager, persistence layer

**Engine Adapter**:
Per-engine search modules under `search/engines/` exporting a standardized `search(query, opts, cred?)` function. `createEngineSearchFn(engine)` factory dispatches via lazy dynamic imports. Replaces the hardcoded `engineFns` inline map in `searchWeb` and `multiEngineWebSearch`.
_Avoid_: search engine, search provider

**Confirmation Gate**:
The boundary between free operations (prefilter/planning) and paid operations (full research). The agent must present the Research Plan and estimated cost to the user and receive explicit approval, then call `confirm_research` before `run_research`. Enforced programmatically by `run_research` rejecting unconfirmed plans.
_Avoid_: approval step, user consent, cost check

**Soft Limit**:
A runtime constraint that caps resource usage during a Research Run. When triggered, the state machine reduces search intensity and skips deeper recursion levels. Limits: `maxSearchCalls`, `maxElapsedSeconds`. Configured in settings. The run still completes — it just becomes shallower.
_Avoid_: hard limit, quota, budget cap

**Telemetry**:
Structured usage data recorded during a Research Run: search API call count, scrape call count, phase durations, and (when available) LLM token usage. Saved as `*-telemetry.json` in `./deep-research/logs/` and appended as a summary table to the final report.
_Avoid_: analytics, metrics, usage report

**Research Log**:
A JSONL trace file recording every discrete event during a Research Run and its Prefilter phase: phase transitions, search calls, scrape calls, errors, injection prompts sent, soft limit triggers, deepening decisions, and artifact saves. Saved as `<runId>.log` in `./deep-research/logs/`. Complements Telemetry (aggregate) with a step-by-step audit trail. One log per Prefilter run (<runId>-prefilter.log), one per Research Run (<runId>.log).
_Avoid_: debug log, trace, audit log

**Mind Map**:
A Mermaid `graph TD` diagram visualizing research findings as a topic tree. Generated at the end of a Research Run (when `deepResearch.mindMap` setting is `true`) or on-demand via the standalone `mind_map` tool. Appended to the report as a `## Mind Map` section containing a ` ```mermaid ` block. Renders in GitHub, VS Code, and any Mermaid-aware viewer.
_Avoid_: diagram, concept map, knowledge graph

**Mapping Phase**:
An optional post-research step gated by the Research Run Orchestrator (not the state machine). After the state machine returns `done`, the orchestrator checks `deepResearch.mindMap`; if enabled, injects a prompt asking the agent to generate a Mind Map from findings, captures the response, and appends it to the report. The state machine is unaware of this phase.
_Avoid_: mind-map generation, diagram phase

**Enriched Search**:
An extension of the `searching` phase where, after synchronous web search completes, the state machine injects a prompt asking the agent to supplement results using Local Sources (grep, find, read) and MCP Sources (mcp__* tools). The agent's raw text response is passed as unstructured context to the extraction phase. Gated by `plan.sources` presence.
_Avoid_: supplemental search, extended search

**Source Type**:
A label on each Finding indicating its provenance: `"web"` (from search engines), `"local"` (from project files via grep/read), or `"mcp"` (from MCP server tools). Assigned by the state machine during extraction based on which source section the finding originated from. Used in Telemetry to break down source counts.
_Avoid_: finding source, origin type

**Local Source**:
A project file or directory searched during Enriched Search using `grep`, `find`, and `read` tools. Specified in `plan.sources.local.paths`. Findings from local sources are tagged `source: "local"` with the file path as `sourceUrl`.
_Avoid_: file source, document source, local document

**MCP Source**:
A Model Context Protocol server tool used during Enriched Search to pull data from external systems (e.g., JIRA, Slack, corporate wiki). Specified in `plan.sources.mcp` as server names. The agent invokes `mcp__<server>__<tool>` during the Enriched Search injection. Findings tagged `source: "mcp"` with the tool identifier as `sourceUrl`.
_Avoid_: MCP data source, external source

**PDF Export**:
Conversion of a markdown research report to a PDF file. Available as a standalone `export_pdf` tool (always available) and as an automatic post-run step gated by `deepResearch.pdfExport` setting. Uses pandoc + weasyprint as primary method; falls back to agent-injected conversion if system tools are missing.
_Avoid_: PDF generation, report export
