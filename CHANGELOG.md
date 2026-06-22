# Changelog

All notable changes to the Pi Deep Research Extension will be documented in this file.

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
