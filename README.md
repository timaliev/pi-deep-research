# Deep Research for Pi

A Pi extension and skill that provides autonomous deep web research — planning research questions, searching the web, scraping sources, extracting findings, and synthesizing a structured markdown report — all using the user's current Pi LLM model.

## Installation

### Via pi packages (recommended)

```bash
pi install git:github.com/timaliev/pi-deep-research
```

This clones the repo, installs dependencies, and links the extension via the `pi.extensions` field in `package.json`.

To pin a specific version:

```bash
pi install git:github.com/timaliev/pi-deep-research@v0.10.1
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
pi install git:github.com/timaliev/pi-deep-research@v0.10.1  # pin new version
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

### `profiles`

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

### `defaultProfile`

Which profile name is the default (shown in prompts, used when agent doesn't specify). Defaults to `"default"`.

```json
"defaultProfile": "deep"
```

### `artifactsDir` / `reportsDir`

Override default output paths. Defaults resolve to `<cwd>/deep-research/artifacts` and `<cwd>/deep-research/reports`. Use relative paths (resolved against `cwd`) or absolute paths.

Logs (`<runId>.log` JSONL trace) always write to `<deep-research-base>/logs/` — derived from `artifactsDir/../logs`. No separate `logsDir` setting.

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
└─────────────────────────────────┘
```

## File Structure

```
extension/
├── index.ts              Extension entry — registers tools
├── prefilter.ts          Three-step research planning
├── state-machine.ts      Research run state machine + profile resolution
├── scraper.ts            Web page scraper
├── logger.ts             JSONL research log
├── ids.ts                Shared ID generation
└── search/
    └── web-search.ts     Multi-engine web search (DDG, Brave, SearXNG)

tests/                    Unit + integration tests (tsx runner)

deep-research/
├── artifacts/            Research plans (prefilter.json)
├── reports/              Final research reports (markdown)
└── logs/                 Research logs (JSONL)
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

| Engine | API Key | Quality |
|---|---|---|
| `duckduckgo` | none | Good (free) |
| `brave` | `BRAVE_API_KEY` env | Better |
| `searxng` | none | Variable (public instances) |

All search calls — user-facing `web_search` tool and pipeline — use the same function with rate-limit backoff and result deduplication.

## Development

```bash
# Run tests
cd extension && node --import tsx --test ../tests/*.test.ts

# 97 tests covering:
# - PrefilterManager (three-step, validation, API key checks)
# - ResearchStateMachine (full cycle, concurrency, soft limits)
# - WebScraper (title/content extraction, error handling)
# - JsonlLogger (write, append, metadata)
# - Telemetry (markdown table generation)
```

## Related Documents

- [CONTEXT.md](CONTEXT.md) — domain glossary
- [docs/adr/0001-state-machine-orchestration.md](docs/adr/0001-state-machine-orchestration.md) — why state machine + injections
- [docs/adr/0002-pluggable-search-backends.md](docs/adr/0002-pluggable-search-backends.md) — search backend evolution
- [docs/adr/0003-plan-driven-parameters.md](docs/adr/0003-plan-driven-parameters.md) — engines/profile negotiation
