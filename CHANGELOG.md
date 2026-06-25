# Changelog

All notable changes to the Pi Deep Research Extension will be documented in this file.

## [0.8.0] — 2026-06-25

### Added

- **Unified multi-engine web search** — `searchWeb()` function with DuckDuckGo (retry/backoff), Brave API, SearXNG public instances. All tools use the same search function. Result deduplication and per-engine rate limiting.
- **Plan-driven parameters** — engines and research profile negotiated during three-step prefilter: agent proposes engines + profile → preliminary search → full plan
- **API key negotiation** — prefilter warns when brave selected without `BRAVE_API_KEY` set
- **Research log** — JSONL trace file (`<runId>.log`) with events: phase transitions, search/scrape calls, errors, injects, soft limits, decisions
- **Agent-driven deepening** — follow-up questions from agent responses used for subsequent search iterations (numbered questions parsed by state machine)
- **Profile resolution** — `resolveProfile()` with hardcoded presets (default/fast/deep/custom), overridable via settings
- **`ResearchPlanProfile` type** — plan stores profile name + optional custom breadth/depth/concurrency
- **`extractQuestions()`** — parses numbered questions from agent response text or content blocks
- 26 new tests: plan-driven params (7), deepening questions (4), logger (4), session state (2), report saving (2), agent response robustness (3), extension load (1), scraper (7 already existed)
- Total: 52 tests

### Changed

- **`plan_research`** now three-step: `{topic}` → `{topic, params_json}` → `{topic/-, plan_json}`
- **`topic` optional** on third plan_research call — extracted from plan_json when missing
- **`estimate_research_cost`** reads profile from plan, not runtime parameter
- **`run_research`** no longer accepts `profile` parameter — locked in plan
- **Search engine selection** moved from `settings.json` to Research Plan — planned, not configured
- **Report auto-saved** by `run_research` (done phase) — `save_report` tool still available for explicit saves
- **Output directory** derived from plan artifact path — consistent across sessions even if `ctx.cwd` changes

### Removed

- **Pluggable SearchProvider interface** — replaced by unified `searchWeb()` function
- **Tavily provider** — removed (can be re-added as engine in `searchWeb`)
- **`searchProvider` setting** — replaced by `engines` array in Research Plan
- **`profile` parameter** on `run_research` and `estimate_research_cost`

### Fixed

- Plan research questions lost after depth 0 — agent questions now drive deepening
- Report saved to wrong directory (`~/.config/pi/agent/` vs project) — `ctx.cwd` used consistently
- Logs scattered across directories — `deepResearchBase` persisted in session state
- `ctx is not defined` — `save_report` missing ctx parameter
- `text.split is not a function` — agentResponse now handles array content blocks
- `Cannot access scraper before initialization` — missing declaration in first-call block
- Duplicate `const entries` declaration causing parse error
- Session state read from `.content` instead of `.data`
- Assistant messages not found — filter uses `message.role` not `entry.type`
- `plan_research` schema rejected `plan_json`-only calls — topic made optional

## [0.7.0] — 2026-06-22

### Added

- **Telemetry section** appended to every saved report — search calls, scrape calls, sources visited, depth, duration, soft limit status
- `buildTelemetrySection()` generates a markdown table from ResearchSnapshot
- 4 new tests + 46 existing = 50 total

## [0.6.0] — 2026-06-22

### Added

- **Soft limits** — `maxSearchCalls` and `maxElapsedSeconds` in ResearchProfile
- When triggered: reduces search breadth to 2, stops depth recursion, goes directly to drafting
- 4 new tests + 42 existing = 46 total

## [0.5.0] — 2026-06-22

### Changed

- **DuckDuckGo provider** now uses `duck-duck-scrape` (VQD-based, anti-detection) as primary search method
- HTML endpoint as automatic fallback when duck-duck-scrape is unavailable
- Retry with exponential backoff (2s → 4s) on search failures
- 2 new tests + 40 existing = 42 total

## [0.4.0] — 2026-06-22

### Added

- **Concurrent search and scrape** — searches and scrapes run in parallel via `ConcurrencySemaphore`, limited by `profile.concurrency`
- 3.7× speedup on breadth=4 (216ms → 58ms in tests)
- 3 concurrency tests + 37 existing = 40 total

## [0.3.0] — 2026-06-22

### Added

- **Integration test** — full pipeline test: plan phase (start → agent → finalize → artifact) + run phase (state machine complete cycle) + end-to-end sequence
- 3 integration tests covering all phases of the research pipeline
- Total: 37 tests (34 unit + 3 integration)

## [0.2.0] — 2026-06-22

### Added

- **TavilyProvider** — Tavily Search API integration (`TAVILY_API_KEY` env var)
- **BraveProvider** — Brave Search API integration (`BRAVE_API_KEY` env var, 2,000 free queries/month)
- **`createSearchProvider()` factory** — selects provider by `deepResearch.searchProvider` setting (`duckduckgo` | `tavily` | `brave`)
- All tools (`web_search`, `plan_research`, `run_research`) now use the configured provider
- 10 new tests (5 Tavily + 5 Brave), total 34 tests

## [0.1.0] — 2026-06-22

### Added

- **Deep Research Pi Extension** — autonomous multi-step web research inside Pi
  - `web_search` tool: DuckDuckGo web search (free, no API key)
  - `scrape_url` tool: fetch and extract readable text from any URL
  - `save_report` tool: persist final markdown report to disk
  - `plan_research` tool: two-step prefilter (preliminary search → JSON research plan)
  - `estimate_research_cost` tool: calculate search/scrape API calls
  - `run_research` tool: state machine orchestrating search→scrape→extract→recurse→draft→save
- **Pluggable search backends**: DuckDuckGo (default), Tavily and Brave opt-in
- **Research profiles**: configurable breadth/depth/concurrency via `~/.pi/settings.json`
- **Confirmation gate**: plan → estimate → user approves → run (paid operations happen only after confirm)
- **Skill instructions** (`SKILL.md`): three-phase protocol with guardrails
- **Glossary** (`CONTEXT.md`): 14 domain terms
- **ADRs**: 0001 (state-machine orchestration), 0002 (pluggable search backends)
- **24 tests**: SearchProvider (5), Scraper (7), PrefilterManager (7), StateMachine (5)

### Infrastructure

- TypeScript extension entry point (`extension/index.ts`)
- Dependency injection: SearchProvider and Scraper as interfaces
- State machine persistence via `pi.appendEntry()`
- Agent reasoning through `pi.sendUserMessage()` injects
- Test suite with mock-based system boundary testing

[0.1.0]:
