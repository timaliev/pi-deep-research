<p align="center">
  <a href="https://github.com/timaliev/pi-deep-research/actions/workflows/test.yml">
     <img src="https://github.com/timaliev/pi-deep-research/actions/workflows/test.yml/badge.svg" alt="Test & Lint"/>
   </a>
  <a href="https://github.com/timaliev/pi-deep-research/actions/workflows/release.yml">
     <img src="https://github.com/timaliev/pi-deep-research/actions/workflows/release.yml/badge.svg" alt="Release"/>
   </a>
</p>

# Deep Research for Pi

A Pi extension and skill that provides autonomous deep web research — planning research questions, searching the web, scraping sources, extracting findings, and synthesizing a structured markdown report — all using the user's current Pi LLM model.

Inspired by [https://github.com/assafelovic/gpt-researcher](gpt-researcher).

## Installation

### Via pi packages (recommended)

```bash
pi install git:github.com/timaliev/pi-deep-research
```

This clones the repo, installs dependencies, and links the extension via the `pi.extensions` field in `package.json`.

To pin a specific version:

```bash
pi install git:github.com/timaliev/pi-deep-research@v0.24.0
```

### Manual

```bash
git clone https://github.com/timaliev/pi-deep-research.git
ln -s $(pwd)/pi-deep-research ~/.pi/agent/extensions/deep-research
```

Pi discovers the extension and skill via `package.json`'s `pi.extensions` and `pi.skills` fields.

### Update

```bash
pi update --extensions  # update all extension packages
pi install git:github.com/timaliev/pi-deep-research@v0.24.0  # pin new version
```

### Uninstall

**Via pi packages:**

```bash
pi remove git:github.com/timaliev/pi-deep-research
```

Removes the package from settings and cleans up the cloned repository.

**Manual:**

```bash
rm ~/.pi/agent/extensions/deep-research     # remove symlink
rm -rf ~/.pi/agent/git/github.com/timaliev/pi-deep-research  # delete clone
```

## Configuration

Configuration can be done in three ways — use any combination that suits your workflow:

1. **Built-in defaults** — works out of the box with no configuration. DuckDuckGo search is enabled by default, profile defaults to `"default"`, and outputs go to `<cwd>/deep-research/`.
2. **`settings.json`** — add a `deepResearch` key to `~/.pi/agent/settings.json` to override profiles, set API keys, or change output directories.
3. **Environment variables** — set search engine API keys and path overrides as env vars (see [Environment Variables](#environment-variables)). Env vars take highest priority.

### Settings cascade

```
env vars  →  .pi/settings.json  →  ~/.pi/agent/settings.json  →  built-in defaults
(highest)                                                       (lowest)
```

### Settings in `settings.json`

Add a `deepResearch` key to `~/.pi/agent/settings.json`:

```json
{
  "deepResearch": {
    "profiles": {
      "deep": { "breadth": 8, "depth": 4, "concurrency": 6 },
      "exhaustive": { "breadth": 10, "depth": 5, "concurrency": 8, "maxSearchCalls": 100 }
    },
    "defaultProfile": "deep",
    "artifactsDir": "./deep-research/artifacts",
    "reportsDir": "./deep-research/reports"
  }
}
```

User profiles **merge** with built-in presets (`default`/`fast`/`deep`). You only need to specify what you want to change or add.

#### `profiles`

Override or extend built-in presets. Partial overrides are merged — missing fields keep built-in values.

```json
"profiles": {
  "deep": { "breadth": 8 },
  "exhaustive": { "breadth": 10, "depth": 5, "concurrency": 8, "maxSearchCalls": 100 }
}
```

| Field | Type | Description |
|---|---|---|
| `breadth` | number | Search queries per question per depth level |
| `depth` | number | Recursive follow-up question iterations |
| `concurrency` | number | Parallel search/scrape calls |
| `maxSearchCalls` | number (optional) | Soft cap on total search API calls (0 = unlimited) |
| `maxElapsedSeconds` | number (optional) | Soft cap on wall-clock runtime (0 = unlimited) |

**Built-in presets** (shown above as defaults): `default`, `fast`, `deep`. Add custom presets:

```json
"profiles": {
  "exhaustive": { "breadth": 10, "depth": 5, "concurrency": 6, "maxSearchCalls": 100 }
}
```

During `plan_research`, the agent can reference any named preset or use `"custom"` with inline `breadth`/`depth`/`concurrency`.

#### `defaultProfile`

Which profile name is the default (shown in prompts, used when agent doesn't specify). Defaults to `"default"`.

```json
"defaultProfile": "deep"
```

#### `searchProviders`

API keys for search engines. Alternative to environment variables — see [Environment Variables](#environment-variables). Env vars win over `settings.json` when both are set.

```json
"searchProviders": {
  "brave": { "apiKey": "BSA..." },
  "tavily": { "apiKey": "tvly-..." },
  "yandex": { "oauthToken": "...", "folderId": "..." }
}
```

Keys per engine:
- `brave`: `apiKey`
- `tavily`: `apiKey`
- `yandex`: `oauthToken`, `folderId`

#### `enabledEngines`

Whitelist which search engines are available. Comma-separated string in env var, array in settings.json. If not set (or empty), built-in defaults (`["duckduckgo", "searxng"]`) are used &mdash; free engines only, no API keys needed. Engines not in the list are excluded from prefilter engine suggestions, even if their API key is configured.

```json
"enabledEngines": ["duckduckgo", "brave", "tavily"]
```

Engines not in the list are excluded from prefilter engine suggestions, even if their API key is configured.

#### `artifactsDir` / `reportsDir`

Override default output paths. Defaults resolve to `<cwd>/deep-research/artifacts` and `<cwd>/deep-research/reports`. Use relative paths (resolved against `cwd`) or absolute paths.

Logs (`<runId>.log` JSONL trace) always write to `<deep-research-base>/logs/` — derived from `artifactsDir/../logs`. No separate `logsDir` setting.

#### `pdfExport`

Auto-export research reports to PDF after each run. Defaults to `false` (opt-in). When enabled, the report is converted to PDF using pandoc + weasyprint after the research run completes.

```json
"pdfExport": true
```

| Env var | Type | Default |
|---------|------|---------|
| `DEEP_RESEARCH_PDF_EXPORT` | `true` | `false` |

Requires `pandoc` and `weasyprint` installed on the system. If missing, falls back to agent-based conversion (browser print-to-PDF). See [PDF Export](#pdf-export) for platform setup instructions.

PDF output path is always derived from the input report path (`.md` → `.pdf`, same directory). Use `export_pdf` tool's `output_path` parameter to override per-call. No separate `DEEP_RESEARCH_PDF_OUTPUT_DIR` env var.

#### `mindMap`

Auto-generate a Mermaid mind map diagram after each research run. Defaults to `false` (opt-in). When enabled, the agent receives a prompt with key findings and generates a `graph TD` Mermaid diagram appended as `## Mind Map` to the report.

```json
"mindMap": true
```

| Env var | Type | Default |
|---------|------|---------|
| `DEEP_RESEARCH_MIND_MAP` | `true` | `false` |

No system dependencies required — the agent generates the diagram using its LLM capabilities.

#### `settingsReport`

Report active configuration with provenance at three points: session start, before each research run, and appended to the final report. All default to `false` (opt-in). Settings are **always logged** to disk regardless of toggles (for debugging).

```json
"settingsReport": {
  "onSessionStart": true,
  "onRunStart": false,
  "inReport": true
}
```

| Setting | Env var | Type | Default |
|---|---|---|---|
| `onSessionStart` | `DEEP_RESEARCH_SETTINGS_ON_SESSION_START` | `true` | `false` |
| `onRunStart` | `DEEP_RESEARCH_SETTINGS_ON_RUN_START` | `true` | `false` |
| `inReport` | `DEEP_RESEARCH_SETTINGS_IN_REPORT` | `true` | `false` |

When active, the settings table shows each setting, its resolved value, and which source won (env var name, settings.json path, or "default"). Credential values are masked as `****`. Profiles are listed with parameters (no source column).

### Environment Variables

All settings can be configured via environment variables. Env vars take priority over `settings.json` values.

#### Paths & Profile

| Variable | Default | Description |
|---|---|---|
| `DEEP_RESEARCH_REPORTS_DIR` | `<cwd>/deep-research/reports` | Report output directory |
| `DEEP_RESEARCH_ARTIFACTS_DIR` | `<cwd>/deep-research/artifacts` | Artifact output directory |
| `DEEP_RESEARCH_DEFAULT_PROFILE` | `default` | Default research profile name |
| `DEEP_RESEARCH_PDF_EXPORT` | `false` | Auto-export reports to PDF (`true`) |
| `DEEP_RESEARCH_MIND_MAP` | `false` | Auto-generate mind map after research (`true`) |
| `DEEP_RESEARCH_SETTINGS_ON_SESSION_START` | `false` | Show settings table on session start (`true`) |
| `DEEP_RESEARCH_SETTINGS_ON_RUN_START` | `false` | Show settings table at plan_research step 1 (`true`) |
| `DEEP_RESEARCH_SETTINGS_IN_REPORT` | `false` | Append settings section to report (`true`) |
| `DEEP_RESEARCH_ENABLED_ENGINES` | `duckduckgo,searxng` | Comma-separated list of allowed search engines |

#### Search Engine API Keys

| Variable | Engine | Description |
|---|---|---|
| `BRAVE_API_KEY` | Brave | Brave Search API key |
| `TAVILY_API_KEY` | Tavily | Tavily Search API key |
| `YANDEX_OAUTH_TOKEN` | Yandex | Yandex OAuth token |
| `YANDEX_FOLDER_ID` | Yandex | Yandex folder/catalog ID |

API keys can also be set in `settings.json` under `deepResearch.searchProviders` (see [Configuration](#configuration)). Env vars win when both are present.

### SearXNG Configuration

SearXNG is a privacy-respecting metasearch engine. The extension queries **public instances** with automatic failover — no configuration required.

**Using a self-hosted SearXNG instance:**

1. Edit `extension/search/engines/searxng.ts`
2. Replace or extend the `SEARXNG_INSTANCES` array:

```ts
const SEARXNG_INSTANCES = [
  "https://your-instance.example.com",  // your instance first
  "https://searx.be",                    // fallback public instances
  "https://search.sapti.me",
];
```

The adapter tries instances in order. If one fails (non-200 or network error), it falls through to the next.

**Self-hosted JSON API requirements:**
- Endpoint: `GET /search?q=<query>&format=json&categories=general`
- Response must include `{ results: [{ title, url, content }] }`
- JSON format must be enabled (`search.formats` includes `json` in `settings.yml`)

## PDF Export

Reports can be exported to PDF via standalone tool or auto-export after each research run.

### Standalone tool

Agent calls `export_pdf(report_path, output_path?)` on any markdown report:

```
export_pdf({ report_path: "deep-research/reports/my-report.md" })
```

Defaults to same directory + `.pdf` extension. Override:
```
export_pdf({ report_path: "my-report.md", output_path: "exports/custom.pdf" })
```

Always available — no configuration required. Falls back to agent-based conversion if system tools are missing.

### Auto-export

Enable `deepResearch.pdfExport` in settings.json or set `DEEP_RESEARCH_PDF_EXPORT=true`. After each research run, the report is automatically converted to PDF.

### Platform setup

**macOS:**
```bash
brew install pandoc
pip3 install weasyprint              # or: pip3 install --break-system-packages weasyprint
npm install -g mermaid-filter        # optional: renders Mermaid diagrams in PDF
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install pandoc
pip install weasyprint
npm install -g mermaid-filter        # optional
```

**Windows:**
```bash
winget install pandoc                # or: choco install pandoc
pip install weasyprint               # requires GTK3 runtime
npm install -g mermaid-filter        # optional
```

If `pandoc` or `weasyprint` are missing, the agent receives a fallback prompt to convert the report via browser print-to-PDF.

## Mind Map

Generate Mermaid mind map diagrams from research findings or any text content.

### Standalone tool

Agent calls `mind_map(topic, content, save_path?)` on any topic:

```
mind_map({ topic: "AI Trends 2026", content: "..." })
```

Always available — no configuration required. The agent responds with a ` ```mermaid ` block containing a `graph TD` diagram. Optionally saves to `save_path`.

### Auto-generation

Enable `deepResearch.mindMap: true` in settings.json or set `DEEP_RESEARCH_MIND_MAP=true`. After each research run, the agent receives key findings and generates a Mermaid mind map appended to the report as `## Mind Map`.

## Architecture

```
user says "research topic X"
        │
        ▼
┌─────────────────────────────────┐
│  plan_research (3-step)         │
│  1. negotiate engines + profile │
│     + report style              │
│  2. preliminary search          │
│  3. agent produces plan JSON    │
│     (incl. reportStyle)         │
│  → saves prefilter.json         │
└──────────────┬──────────────────┘
               │ user confirms
               ▼
┌─────────────────────────────────┐
│  run_research (state machine)   │
│  searching → extracting →       │
│  questioning → drafting → done  │
│                                 │
│  Each phase injects prompt into │
│  agent conversation, waits for  │
│  agent response, advances.      │
│                                 │
│  → saves report.md              │
│  → saves <runId>.log (JSONL)    │
│  → exports report.pdf (if       │
│    pdfExport enabled)           │
└─────────────────────────────────┘
```

## File Structure

```
extension/
├── index.ts                    Extension entry — registers tools
├── prefilter.ts                Three-step research planning
├── state-machine.ts            Research run state machine
├── scraper.ts                  Web page scraper
├── export-pdf.ts               PDF conversion (pandoc + fallback)
├── logger.ts                   JSONL research log
├── ids.ts                      Shared ID generation
├── slug.ts                     Topic → filename slug
├── profile-resolver.ts         Profile resolution with user override merging
├── settings-context.ts         Unified settings + SearchProviderCredentials + provenance
├── settings-reporter.ts        Settings table/log builder + report section appender
├── session-state.ts            Unified persistence seam
├── settings-context.ts         Settings cascade (env → project → user → defaults)
├── report-assembly.ts          Final report assembly with telemetry
├── report-styles.ts            Report style templates (narrative, subtopics)
├── release-monitor.ts         GitHub release check (ADR-0018)
├── research-run-orchestrator.ts Pre/post-run hooks (plan confirmation, mind map, PDF)
├── search-queue.ts             Controlled concurrency queue
└── search/
    ├── web-search.ts           Multi-engine search (dispatch + retry/backoff)
    ├── rate-limiter.ts         Rate-limiting with exponential backoff
    └── engines/
        ├── duckduckgo.ts       DuckDuckGo (free, zero-config)
        ├── brave.ts            Brave Search API adapter
        ├── searxng.ts          SearXNG public instances
        ├── tavily.ts           Tavily Search API
        ├── yandex.ts          Yandex Search API
        └── duckduckgo.ts      DuckDuckGo (free, zero-config)

tools/
├── save-report.ts             Save report tool (path resolution, telemetry)
├── plan-research.ts           Three-step prefilter tool (manager scoped per plan)
└── run-research.ts            Research run tool (orchestrator + confirmation gate)

tests/                          Unit + integration tests (tsx runner, 45 files)

deep-research/
├── artifacts/                  Research plans (prefilter.json)
├── reports/                    Final research reports (markdown)
└── logs/                       Research logs (JSONL)
```

## Key Concepts

| Term | Description |
|---|---|
| **Research Plan** | JSON artifact: topic, goal, research questions, engines, profile, report style, scope, estimated cost |
| **Research Profile** | Named preset (default/fast/deep) or custom (breadth/depth/concurrency). Negotiated during prefilter, stored in plan |
| **Report Style** | `narrative` — fixed 5-section template (Introduction/Findings/Analysis/Recommendations/Sources). `subtopics` — LLM discovers 5–10 thematic sections with subsections, data tables, and quotes |
| **Prefilter** | Three-step: (1) negotiate engines+profile, (2) preliminary search, (3) agent writes plan |
| **Injection** | Prompt sent into agent conversation via `pi.sendUserMessage()` — the tool never calls the LLM directly |
| **Research Log** | JSONL trace file (`<runId>.log`) — every phase transition, search/scrape call, error, decision |
| **Soft Limit** | Runtime cap (maxSearchCalls, maxElapsedSeconds) — reduces intensity, skips deeper recursion |
| **Confirmation Gate** | Agent must present plan + cost estimate, get user approval before `run_research` |

## Search Engines

Built-in `searchWeb()` function (multi-engine, retry with exponential backoff):

| Engine | API Key | Quality | Notes |
|---|---|---|---|
| `duckduckgo` | none | Good | Free, zero-config, always available |
| `brave` | required | Better | Higher quality results, generous free tier |
| `searxng` | none | Variable | Public instances with automatic failover |
| `tavily` | required | Best | AI-optimized, extracts clean content |
| `yandex` | required | Good | Russian/global coverage |

All search calls — user-facing `deep_web_search` tool and pipeline — use the same function with rate-limit backoff and result deduplication.

See [Environment Variables](#environment-variables) for API key configuration.

## Development

See [docs/development.md](docs/development.md) for the full quality gate checklist.

```bash
npm test              # 429 tests across 53 files
npm run format        # auto-format with biome
npm run lint          # biome lint
```

## Related Documents

- [CONTEXT.md](CONTEXT.md) — domain glossary
- [Architecture Review (July 2026)](docs/architecture-review-2026-07.md) — deepening opportunities

### Architecture Decisions (ADRs)

| ADR | Status | Topic |
|---|---|---|
| [0001](docs/adr/0001-state-machine-orchestration.md) | accepted | State machine phases + agent injection prompts |
| [0002](docs/adr/0002-pluggable-search-backends.md) | superseded | Pluggable backends → unified multi-engine |
| [0003](docs/adr/0003-plan-driven-parameters.md) | accepted | Engines/profile negotiated in prefilter |
| [0004](docs/adr/0004-profile-resolution-from-settings.md) | accepted | Profile resolution from user settings |
| [0005](docs/adr/0005-search-provider-credentials.md) | accepted | Search provider credentials from settings.json |
| [0006](docs/adr/0006-extension-version-in-telemetry.md) | accepted | Extension version in report telemetry |
| [0007](docs/adr/0007-research-context-bundle.md) | accepted | ResearchContext bundled constructor |
| [0008](docs/adr/0008-session-state-module.md) | accepted | SessionState unified persistence seam |
| [0009](docs/adr/0009-engine-adapters.md) | accepted | Per-engine search adapters |
| [0010](docs/adr/0010-presets-ownership.md) | superseded | Presets ownership — superseded by ProfileResolver (C2) |
| [0011](docs/adr/0011-logger-locality.md) | accepted | Logger locality — state machine owns log |
| [0012](docs/adr/0012-settings-context-cascade.md) | accepted | SettingsContext unified settings cascade |
| [0013](docs/adr/0013-mind-map-and-mcp-sources.md) | partially accepted | Mind map, MCP/local sources, repo link |
| [0014](docs/adr/0014-pdf-export.md) | accepted | PDF export of research reports |
| [0015](docs/adr/0015-research-draft-module.md) | accepted | ResearchDraft module — collapse triple-path draft |
| [0016](docs/adr/0016-orchestrator-post-processing.md) | accepted | Move post-processing to orchestrator |
| [0017](docs/adr/0017-llm-introspection-source-tagged-questions.md) | accepted | LLM introspection + source-tagged questions (Q8 deferred) |
| [0018](docs/adr/0018-release-monitor.md) | accepted | Release monitor on session start |
| [0019](docs/adr/0019-tui-confirmation-gate.md) | accepted | TUI confirmation gate for research plans |
| [0020](docs/adr/0020-settings-reinit-session-start.md) | accepted | SettingsContext re-init on session_start |
| [0021](docs/adr/0021-save-report-report-path.md) | accepted | save_report report_path for large reports |
| [0022](docs/adr/0022-done-phase-steer-messages.md) | accepted | Remove redundant steer from done phase |
| [0024](docs/adr/0024-prefilter-context-bundle.md) | accepted | PrefilterContext — bundled constructor for PrefilterManager |
| [0025](docs/adr/0025-state-machine-resume.md) | accepted | State machine resume — move draft restoration inside the machine |
