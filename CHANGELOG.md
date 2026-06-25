# Changelog

All notable changes to the Pi Deep Research Extension will be documented in this file.

## [0.9.0] — 2026-06-26

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
