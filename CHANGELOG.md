## [0.16.11] - 2026-06-30

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.11
## [0.16.10] - 2026-06-30

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.10
## [0.16.9] - 2026-06-30

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.9
## [0.16.8] - 2026-06-30

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.8
## [0.16.7] - 2026-06-30

### ⚙️ Miscellaneous Tasks

- Trigger CI release for v0.16.6
- *(release)* Bump to 0.16.7
## [0.16.6] - 2026-06-30

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.6
## [0.16.5] - 2026-06-30

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.5
## [0.16.4] - 2026-06-30

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.4
## [0.16.3] - 2026-06-30

### 🚀 Features

- *(prefilter)* Show engine API key availability (✅/❌) in params prompt

### 🐛 Bug Fixes

- *(telemetry)* Add profile params to report, rename Version label
- *(runId)* Single shared runId across prefilter and research run
- RunId YYYYMMDD-HHmmss format, reportStyle in telemetry, random queue delays, resultsCount in artifact
- Store scrapedUrls in artifact, DDG delay 2000-4000ms
- *(ci)* Add contents:write permission to release workflow
- *(prefilter)* Reuse PrefilterManager across plan_research calls
- Idempotent plan_research, dedup telemetry, git-cliff release notes
- *(ci)* Update CHANGELOG.md on release, use latest-only for release body
- *(ci)* Remove CHANGELOG push from workflow, update locally instead
- Report filename uses runId prefix instead of date
- *(ci)* Test on all branches except master, regenerate full CHANGELOG on release
- Strip tool-call XML from extractTextContent string input
- Include report-assembly.ts (missing from orchestrator branch)

### 💼 Other

- Refactor/extract-phase-router — add phaseRouter pure function
- Refactor/extract-report-assembly — ReportAssembly module
- Refactor/extract-research-run-orchestrator — wire orchestrator into index.ts

### 🚜 Refactor

- *(state-machine)* Extract phaseRouter as pure function, decouple phase decision from injection building
- *(report)* Extract ReportAssembly module, shrink index.ts done phase by 20 lines
- *(logger)* Inject logger through ResearchContext, eliminate dual logger pattern
- *(orchestrator)* Wire ResearchRunOrchestrator into index.ts, shrink handler from 150 to 60 lines

### 📚 Documentation

- *(skill)* Broaden engine list, add settings.json keys, fix drafting conflict, add plan_artifact_path guardrail
- *(skill)* Instruct agent to check available API keys from tool response before proposing engines

### 🧪 Testing

- Add unit tests for extractTextContent utility

### ⚙️ Miscellaneous Tasks

- Mark completed tasks in TODO.md and clean up old artifacts
- Sync package.json version to 0.16.9 from master
- *(release)* Bump to 0.16.10
- *(release)* Configure git remote with release PAT token
- *(workflows)* Split changelog generation (PR) from release (master push)
- *(changelog)* Use --tag flag instead of --bumped-version for git-cliff
- *(release)* Bump version to 0.17.0
- *(release)* Bump to 0.16.3
## [0.16.2] - 2026-06-30

### 🐛 Bug Fixes

- *(extension)* Harden draft persistence, validate settings format, unify runId naming

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.1, update changelog
## [0.16.0] - 2026-06-30

### 🐛 Bug Fixes

- Remove orphan closing braces from draft restore replacement
- Plan_research and save_report use settings.artifactsDir/reportsDir instead of ctx.cwd
- Pass credentials to multiEngineWebSearch in web_search tool

### ⚙️ Miscellaneous Tasks

- *(release)* Bump to 0.16.0, update changelog, add release workflow
## [0.15.0] - 2026-06-30

### 🚜 Refactor

- SettingsContext — unified settings cascade (ADR-0012)
## [0.14.3] - 2026-06-29

### 🚜 Refactor

- Move DEFAULT_PRESETS+resolveProfile to profile-resolver (ADR-0010)
## [0.14.2] - 2026-06-29

### 🚜 Refactor

- Move injection prompts behind ReportStyle adapters
- Wire SessionState into index.ts + extract engine adapters
## [0.14.1] - 2026-06-29

### 🐛 Bug Fixes

- Resolve four extension failures

### 🚜 Refactor

- Bundle ResearchStateMachine constructor into ResearchContext object

### 📚 Documentation

- Add ADR-0007 and CONTEXT.md for ResearchContext + SessionState
## [0.14.0] - 2026-06-29

### 🚀 Features

- *(telemetry)* Add artifact reference links below telemetry table
- *(brave)* Implement Brave search per API documentation

### 🐛 Bug Fixes

- *(telemetry)* Append telemetry in save_report when auto-save data available

### ⚙️ Miscellaneous Tasks

- Add GitHub Actions test workflow on push and PR
- *(release)* Bump version to 0.14.0
## [0.13.3] - 2026-06-29

### 🚀 Features

- *(queue)* Build search request queue with delay scheduling
## [0.13.2] - 2026-06-29

### 🚀 Features

- *(telemetry)* Add extension version row to report telemetry
## [0.13.1] - 2026-06-29

### 🚀 Features

- *(credentials)* Add SearchProviderCredentials from settings.json

### 🚜 Refactor

- *(profiles)* Simplify settings loading to ~/.pi/agent/settings.json only

### 📚 Documentation

- Add project TODO list
- Add GitHub release workflow item to TODO

### 🧪 Testing

- *(profiles)* Add integration tests for settings merge and prompt resolution
## [0.13.0] - 2026-06-29

### 🚀 Features

- *(profiles)* Add ProfileResolver with settings.json merging and defaultProfile
## [0.12.1] - 2026-06-26

### 💼 Other

- *(gate)* Fix appendEntry API call in confirm_research

### ⚙️ Miscellaneous Tasks

- *(release)* Bump version to 0.12.0
- *(release)* Bump version to 0.12.1
## [0.12.0] - 2026-06-26

### 🚀 Features

- *(research)* Add confirm_research gate and fix scrape estimate
## [0.11.1] - 2026-06-26

### 💼 Other

- *(ext)* Restore baseDir declaration removed during topicToSlug extraction

### ⚙️ Miscellaneous Tasks

- *(release)* Bump version to 0.11.1
## [0.11.0] - 2026-06-26

### 🚀 Features

- *(research)* Add reportStyle choice to prefilter plan

### 🐛 Bug Fixes

- *(research)* Handle cyrillic topics in slug and add draftReport diagnostics
- *(research)* Deduplicate save_report and auto-save report paths

### 📚 Documentation

- *(readme)* Add reportStyle to key concepts and architecture diagram

### ⚙️ Miscellaneous Tasks

- *(release)* Bump version to 0.11.0
## [0.10.1] - 2026-06-25

### 🐛 Bug Fixes

- *(tool)* Add tavily and yandex to web_search StringEnum

### ⚙️ Miscellaneous Tasks

- *(release)* Bump version to 0.10.1
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
