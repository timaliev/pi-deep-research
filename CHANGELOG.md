# Changelog

All notable changes to the Pi Deep Research Extension will be documented in this file.

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

[0.1.0]: https://github.com/user/deep-research-codex/tree/v0.1.0
