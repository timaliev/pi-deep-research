# Changelog

All notable changes to the Pi Deep Research Extension will be documented in this file.

## [0.16.2] — 2026-06-30

### 🐛 Bug Fixes

- *(session)* draftReport recovery now uses dedicated session entry — eliminates fragile assistant-message extraction
- *(session)* doSaving accepts agentResponse fallback when draft was stripped by persistence
- *(settings)* normalizeSearchProviders — array format and field casing now validated at SettingsContext seam
- *(index)* prefilter log uses generateRunId() for consistent naming with research logs

## [0.16.1] — 2026-06-30

### 🚀 Features

- *(search)* Distribute queries round-robin across multiple engines when plan.engines > 1
- *(telemetry)* Add profile name + parameters (breadth, depth, concurrency) to report telemetry
- *(telemetry)* Rename telemetry label "Version" → "Pi Extension version"
- *(prefilter)* Use generateRunId() for prefilter log filename (consistent format)

### 🐛 Fixes

- *(drafting)* Strip tool-call XML from extractTextContent string input — fixes 56-byte reports
- *(reports)* Use settings.reportsDir from SettingsContext instead of hardcoded CWD path
- *(logging)* Rename inject_sent data field type→injectType to prevent event type collision
- *(run)* Guard against accidental re-init when agent passes plan_artifact_path on drafting call
- *(run)* Fix deepResearchBase operator precedence bug — || bound tighter than ?:

### 🏗️ Architecture

- *(orchestrator)* Extract ResearchRunOrchestrator — first-call/subsequent-call branching (ADR-0014)
- *(report)* Extract ReportAssembly module — markdown + telemetry + artifact links (ADR-0013)
- *(state)* Extract phaseRouter pure function — phase decision decoupled from Injection (ADR-0015)
- *(logger)* Inject logger through ResearchContext — single instance per run (ADR-0011 amended)
- *(draft)* Guard restoreDraft behind snapshot.phase === "drafting" check

### 🔧 Refactor

- *(index)* Shrink index.ts from 470 to 386 lines via orchestrator + ReportAssembly extraction
- *(index)* run_research handler: 150 → 60 lines

### 📚 Documentation

- *(readme)* Add tavily/yandex engines, mark all ADRs as current
- *(context)* Add ReportAssembly, ResearchRunOrchestrator, PhaseRouter terms to CONTEXT.md
- *(skill)* Update output section to reflect configurable paths
- *(adr)* Fix 7 outdated ADR references (0002, 0004, 0005, 0006, 0007, 0008, 0012)

### 🧪 Tests

- +50 tests across 16 test files
- New: extractTextContent, logger collision guard, research-run-orchestrator, report-assembly, phase-router, deep-research-base-path, engine-distribution, telemetry-labels

### ⚙️ CI/CD

- *(workflow)* Add GitHub Actions release workflow (test gate before release)

## [0.16.0] — 2026-06-30

### 🔧 Refactor

- *(session)* Wire SessionState into index.ts + extract engine adapters
- *(settings)* SettingsContext singleton — unified cascade env → local → global → built-in (ADR-0012)

### 🐛 Fixes

- *(session)* remove orphan closing braces from draft restore replacement

## [0.15.0] — 2026-06-30

### 🏗️ Architecture

- *(settings)* SettingsContext singleton — unified cascade env → local → global → built-in (ADR-0012)
- Wire index.ts to use SettingsContext — removes scattered loadDeepResearchSettings + loadSearchProviders

### 🔧 Refactor

- *(settings)* profiles, API keys, dirs all follow same priority chain
- *(settings)* search providers now merge local → global (was global-only)

### 🧪 Tests

- +11 SettingsContext cascade tests
- Fix profile-integration TEST_DIR collision

## [0.14.3] — 2026-06-29

### 🔧 Refactor

- *(profile)* Move DEFAULT_PRESETS + resolveProfile to profile-resolver.ts (ADR-0010)
- *(logger)* ResearchStateMachine creates logger internally, removes from ResearchContext (ADR-0011)

### 🧪 Tests

- +10 architecture tests for presets ownership + logger locality

## [0.14.2] — 2026-06-29

### 🔧 Refactor

- *(session)* Wire SessionState module into index.ts — remove key constants, draft restore, appendEntry calls
- *(search)* Extract engine adapters with createEngineSearchFn factory + per-engine modules

### 📚 Docs

- ADR-0008: SessionState unified persistence seam
- ADR-0009: Engine adapters
- CONTEXT.md: SessionState + Engine Adapter terms

## [0.14.1] — 2026-06-29

### 🔧 Refactor

- *(state)* Bundle ResearchStateMachine constructor into ResearchContext object (6 params → 1)
- *(state)* Create SessionState module for persistence seam (pending index.ts wiring)

### 📚 Docs

- ADR-0007: ResearchContext bundled constructor
- CONTEXT.md: ResearchContext term

## [0.14.0] — 2026-06-29

### 🚀 Features

- *(brave)* Implement Brave web search per API documentation (freshness, country, lang, extra_snippets, pagination)
- *(queue)* Build search request queue with delay scheduling, save as JSON artifact
- *(telemetry)* Add artifact reference links below telemetry table
- *(telemetry)* Append telemetry in save_report when auto-save data available

### 🐛 Fixes

- *(telemetry)* save_report now appends telemetry from auto-save session state

### 🧪 Tests

- 27 new tests: Brave search (13), queue (9), artifact links (5)

## [0.13.3] — 2026-06-29

### 🚀 Features

- *(queue)* Build search request queue with delay scheduling, save as JSON artifact for post-mortem

### 🧪 Tests

- 9 new tests: queue builder, round-robin, delay accumulation, save/round-trip

## [0.13.2] — 2026-06-29

### 🚀 Features

- *(telemetry)* Add extension version row to report telemetry table (read from package.json)

### 🧪 Tests

- 6 new tests: telemetry version row, version reading from package.json

## [0.13.1] — 2026-06-29

### 🚀 Features

- *(credentials)* Add SearchProviderCredentials — load API keys from settings.json (env vars win)
- *(credentials)* Wire into prefilter checkApiKeys with fallback to process.env

### 🧪 Tests

- 11 new tests: credential load, get, env override, has, prefilter integration

## [0.13.0] — 2026-06-27

### 🚀 Features

- *(profiles)* Add ProfileResolver — load, merge, and resolve profiles from settings.json
- *(profiles)* Support defaultProfile config key to change which profile is the default
- *(profiles)* User profiles merge with built-ins (override fields, add new presets)

### 🧪 Tests

- 12 new tests: settings loading, profile merge, ProfileResolver resolve/fallback/custom/listNames

## [0.12.1] — 2026-06-27

### 🐛 Hotfix

- *(gate)* Fix appendEntry API call in confirm_research (use pi.appendEntry, not ctx.sessionManager.appendEntry)

## [0.12.0] — 2026-06-27

### 🚀 Features

- *(gate)* Add confirm_research tool — programmatic confirmation gate before run_research
- *(estimate)* Fix scrape estimate formula (~1.5x searches instead of 2x)

### 🐛 Hotfix

- *(ext)* Restore baseDir declaration accidentally removed during topicToSlug extraction

## [0.11.0] — 2026-06-26

### 🚀 Features

- *(report)* Add reportStyle choice to prefilter plan — narrative (fixed 5-section) or subtopics (LLM discovers thematic sections)
- *(slug)* Handle Cyrillic topics in report filenames with transliteration fallback

### 🐛 Bug Fixes

- *(report)* Deduplicate save_report and auto-save report paths via session state
- *(draft)* Add diagnostic logging for draftReport emptiness at auto-save

### 📚 Documentation

- *(readme)* Add reportStyle to key concepts and architecture diagram

## [0.10.1] — 2026-06-26

### 🐛 Bug Fixes

- *(tool)* Add tavily and yandex to web_search StringEnum
## [0.10.0] - 2026-06-25

### 🚀 Features

- *(search)* Add tavily and yandex search engines

### 🧪 Testing

- *(search)* Add tavily and yandex search integration tests

### ⚙️ Miscellaneous Tasks

- *(release)* Bump version to 0.10.0
## [0.9.0] - 2026-06-25

### 🚀 Features

- *(package)* Add skills section to pi config

### 🐛 Bug Fixes

- *(package)* Add root package.json with pi.extensions, drop stale dep
- *(pipeline)* Prevent empty reports and DDG rate-limiting

### 📚 Documentation

- *(readme)* Add installation instructions
- *(readme)* Add uninstall section and configuration reference

### 🧪 Testing

- *(package)* Add skills field assertion
- *(pipeline)* Add drafting and DDG stagger tests

### ⚙️ Miscellaneous Tasks

- *(release)* Merge v0.8.0 to master
- *(release)* Bump version to 0.9.0
## [0.8.0] - 2026-06-25

### 🚀 Features

- *(search)* Add multi-engine web search with DDG, Brave, SearXNG
- *(log)* Add JSONL research log with event tracing
- *(prefilter)* Three-step plan-driven params with engines and profile

### 🐛 Bug Fixes

- *(research)* Agent questions drive deepening, persist output dir in state
- *(index)* Remove duplicate entries declaration causing parse error
- *(index)* Declare scraper before use in first-call block
- *(index)* Read session state from CustomEntry.data not .content
- *(report)* Save to cwd, read assistant via message.role
- Handle array content in agentResponse, extract topic from plan_json
- *(save_report)* Add ctx parameter to execute signature
- *(plan_research)* Make topic optional, extract from plan_json when missing

### 🚜 Refactor

- *(search)* Unify search seam, replace SearchProvider with searchWeb
- *(ids)* Deduplicate generateRunId into shared module

### 📚 Documentation

- *(readme)* Update to v0.7.0 with soft limits and telemetry
- *(readme)* Update to v0.7.0 with soft limits and telemetry
- Add README, update glossary, ADR for plan-driven params
- *(skill)* Update protocol for three-step prefilter and plan-driven params
- *(skill)* Topic optional on plan_json, numbered questions for deepening, auto-save

### ⚙️ Miscellaneous Tasks

- *(release)* Merge v0.8.0 to master
## [0.7.0] - 2026-06-22

### 🚀 Features

- *(report)* Add telemetry section to final report
- *(report)* Merge telemetry

### 📚 Documentation

- *(changelog)* Add v0.7.0 entries

### ⚙️ Miscellaneous Tasks

- *(release)* V0.7.0
## [0.6.0] - 2026-06-22

### 🚀 Features

- *(research)* Add soft limits (maxSearchCalls, maxElapsedSeconds)
- *(research)* Merge soft limits

### 📚 Documentation

- *(readme)* Add comprehensive README with architecture, design decisions, and original work references
- *(license)* Add MIT license
- *(license)* Add MIT license
- *(changelog)* Add v0.6.0 entries

### ⚙️ Miscellaneous Tasks

- *(release)* V0.6.0
## [0.5.0] - 2026-06-22

### 🚀 Features

- *(search)* Add duck-duck-scrape integration with retry and HTML fallback
- *(search)* Merge DDG integration with retry

### 📚 Documentation

- *(changelog)* Add v0.5.0 entries

### ⚙️ Miscellaneous Tasks

- *(release)* V0.5.0
## [0.4.0] - 2026-06-22

### 🚀 Features

- *(research)* Add concurrent search and scrape with semaphore
- *(research)* Merge concurrent search and scrape

### 📚 Documentation

- *(changelog)* Add v0.4.0 entries

### ⚙️ Miscellaneous Tasks

- *(release)* V0.4.0
## [0.3.0] - 2026-06-22

### 📚 Documentation

- *(changelog)* Add v0.3.0 entries

### 🧪 Testing

- *(integration)* Add full pipeline integration test
- *(integration)* Merge full pipeline test

### ⚙️ Miscellaneous Tasks

- *(release)* V0.3.0
## [0.2.0] - 2026-06-22

### 🚀 Features

- *(search)* Add Tavily and Brave search providers
- *(search)* Merge Tavily and Brave providers

### 📚 Documentation

- *(changelog)* Add v0.2.0 entries

### ⚙️ Miscellaneous Tasks

- *(release)* V0.2.0
## [0.1.0] - 2026-06-22

### ⚙️ Miscellaneous Tasks

- *(release)* V0.1.0 — Pi deep research extension
