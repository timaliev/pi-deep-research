# pi-deep-research

Autonomous deep web research extension for [Pi coding agent](https://github.com/earendil-works/pi-coding-agent). Plans research questions, searches the web, scrapes sources, extracts findings, and synthesizes structured markdown reports — all using the user's current Pi LLM model.

## Overview

`pi-deep-research` brings ChatGPT/Claude-style deep research into Pi. Describe a topic in plain language, and the agent will:

1. **Plan** — perform preliminary web searches, ask the LLM to formulate targeted research questions, and show an estimated cost breakdown.
2. **Confirm** — present the plan and wait for explicit user approval before any paid operations.
3. **Research** — run a recursive search→scrape→extract→question loop with configurable breadth and depth.
4. **Report** — synthesize a structured markdown report with cited sources, saved to disk.

## Quick Start

```bash
git clone https://github.com/timaliev/pi-deep-research.git
```

In Pi, just ask naturally:

```
Research the current state of WebGPU adoption in browsers
Do a deep research on quantum computing startups in 2025
```

The agent will plan, show you the estimated cost, and ask for confirmation before diving in.

## Features

- **Zero-config default** — DuckDuckGo search works out of the box, no API keys required.
- **Pluggable search backends** — opt into Tavily or Brave Search for higher quality results.
- **Configurable depth profiles** — `fast` (2/1/2), `default` (4/2/4), `deep` (6/3/4) for breadth/depth/concurrency.
- **Concurrent search & scrape** — parallel fetches with a semaphore-limited concurrency pool (3.7× speedup vs sequential).
- **State-machine orchestration** — the extension manages research flow across agent turns via prompt injections, keeping the Pi LLM as the sole reasoning engine.
- **Prefilter planning** — an initial search phase produces a structured Research Plan (JSON) before any paid API calls.
- **Retry & fallback** — DuckDuckGo searches use `duck-duck-scrape` (VQD-based, anti-detection) with fallback to HTML scraping and exponential backoff retry.
- **Soft limits** — configurable `maxSearchCalls` and `maxElapsedSeconds` cap resource usage per run, reducing search intensity and skipping deeper recursion when triggered.
- **Telemetry in reports** — every saved report includes a markdown table with search calls, scrape calls, sources visited, depth reached, duration, and soft limit status.
- **50 tests** — unit tests for every component plus full pipeline integration tests.

## Prerequisites

- **Pi coding agent** — `pi-deep-research` is a Pi extension. Install Pi first: `npm install -g @earendil-works/pi-coding-agent`
- **Node.js ≥ 18**
- **Optional**: Tavily API key (`TAVILY_API_KEY` env var) or Brave API key (`BRAVE_API_KEY`) for paid search providers.

## Configuration

Settings live in `~/.pi/settings.json` under `deepResearch`:

```json
{
  "deepResearch": {
    "searchProvider": "duckduckgo",
    "profiles": {
      "default": { "breadth": 4, "depth": 2, "concurrency": 4 },
      "fast":    { "breadth": 2, "depth": 1, "concurrency": 2 },
      "deep":    { "breadth": 6, "depth": 3, "concurrency": 4 }
    }
  }
}
```

| Setting | Values | Default | Description |
|---|---|---|---|
| `searchProvider` | `"duckduckgo"`, `"tavily"`, `"brave"` | `"duckduckgo"` | Web search backend |
| `profiles` | `{ breadth, depth, concurrency }` | see above | Research intensity presets |

To use Tavily or Brave:

```bash
export TAVILY_API_KEY="tvly-..."
export BRAVE_API_KEY="BSA..."
```

## Architecture

### Tools registered with Pi

| Tool | Description |
|---|---|
| `web_search` | Search the web via the configured provider |
| `scrape_url` | Fetch a URL and extract readable text content |
| `plan_research` | Two-step prefilter: preliminary search → JSON research plan |
| `estimate_research_cost` | Calculate expected search/scrape calls from a plan |
| `run_research` | State machine orchestrating the full research loop |
| `save_report` | Persist the final markdown report to disk |

### Workflow

```
User query
  → plan_research (preliminary search + scrape)
  → LLM produces JSON Research Plan
  → plan_research validates & saves prefilter.json
  → estimate_research_cost shows breakdown
  → User confirms
  → run_research (state machine loop)
      searching → extracting → questioning → ... (recurse depth)
      → drafting → saving → done
  → Report saved to ./deep-research/reports/
```

### State machine phases

Each call to `run_research` advances through phases:

1. **searching** — concurrent web searches + scrapes for active questions
2. **extracting** — LLM processes search results, extracts findings with citations
3. **questioning** — LLM generates follow-up questions for the next depth iteration
4. **drafting** — LLM synthesizes a full structured markdown report
5. **saving** — report is persisted to disk
6. **done** — terminal state

State is persisted across invocations via `pi.appendEntry()` and survives session restarts.

### Reasoning via injections

The extension cannot call the LLM directly. For reasoning steps (extract findings, generate questions, draft report), it injects a prompt into the Pi conversation via `pi.sendUserMessage()`. The agent processes it in the next turn and calls `run_research` again. This keeps the user's Pi LLM model as the sole reasoning engine.

## Design Decisions

See `docs/adr/` for full Architecture Decision Records.

### ADR 0001: State-machine orchestration via agent injections

**Chosen**: A state machine driven by repeated agent invocations with prompt injections.

**Rejected alternatives**:
- *Agent-orchestrated* (register simple tools, let Pi drive) — context window would overflow with intermediate results; no concurrency.
- *Autonomous subprocess* (fork GPT Researcher) — cannot share Pi's LLM model with an external process; loses Pi-native UI integration.

**Consequence**: The agent must follow the skill protocol strictly — call `run_research` repeatedly until `phase: "done"`. Without this discipline, the state machine stalls.

### ADR 0002: Pluggable search backends with DuckDuckGo as zero-config default

**Chosen**: A `SearchProvider` interface with DuckDuckGo as the default (free, no API key). Tavily and Brave are opt-in upgrades.

**Rejected alternatives**:
- *Tavily only* — requiring a paid API key before the extension works creates unnecessary friction.
- *DuckDuckGo only* — fragile HTML scraping, lower quality snippets; power users need better options.

**Consequence**: The `SearchProvider` interface must remain stable. DDG scraping may break when DuckDuckGo changes its HTML — the extension will surface clear errors and suggest switching providers.

## Project Structure

```
pi-deep-research/
├── extension/             # Pi extension (TypeScript)
│   ├── index.ts           # Entry point, registers all tools
│   ├── prefilter.ts       # PrefilterManager — planning phase
│   ├── state-machine.ts   # ResearchStateMachine — execution phases
│   ├── scraper.ts         # WebScraper — HTML fetch & text extraction
│   └── search/
│       ├── provider.ts    # SearchProvider interface
│       ├── duckduckgo.ts  # DuckDuckGo (duck-duck-scrape + HTML fallback)
│       ├── tavily.ts      # Tavily Search API
│       └── brave.ts       # Brave Search API
├── skill/
│   └── SKILL.md           # Pi skill instructions (3-phase protocol)
├── tests/                 # 50 tests (unit + integration)
├── docs/
│   ├── adr/               # Architecture Decision Records
│   └── diagrams/          # Excalidraw diagrams
├── CHANGELOG.md           # Conventional commits changelog
├── CONTEXT.md             # Domain glossary (14 terms)
└── gptsearch/             # Original deep-research-codex (Python/shell)
```

## Original Work

This project builds on two prior research systems:

### [GPT Researcher](https://github.com/assafelovic/gpt-researcher) by Assaf Elovic

GPT Researcher is an autonomous agent that generates comprehensive online research reports. It handles search, scraping, context extraction, and report generation across multiple LLM providers. The recursive research loop (search → scrape → extract → recurse) and the breadth/depth profile concept originate here.

### [deep-research-codex](https://github.com/mikemelanin/deep-research-codex) by Mike Melanin

A local deep-research runner that wraps GPT Researcher inside a Codex skill. Introduced the two-step prefilter pattern: normalize a raw user query → get explicit confirmation → then run paid web research. `pi-deep-research` adopts the prefilter workflow and confirmation gate from this project.

The `gptsearch/` directory contains the original `deep-research-codex` codebase for reference. The Pi-native implementation in `extension/` is a ground-up TypeScript rewrite that integrates directly with Pi's extension API, uses the agent's own LLM rather than external Bedrock models, and runs the research loop as a state machine rather than a child process.

## Testing

```bash
cd extension
npm test
```

50 tests covering:
- Search providers (DuckDuckGo, Tavily, Brave) — 12 tests
- Scraper — 7 tests
- Prefilter manager — 7 tests
- State machine — 5 tests
- Concurrency — 3 tests
- DDG retry — 1 test
- Soft limits — 4 tests
- Telemetry — 4 tests
- Integration (full pipeline) — 3 tests
- Plus 4 legacy tests

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history. Maintained with [git-cliff](https://git-cliff.org) from conventional commits.

| Version | Highlights |
|---|---|
| v0.7.0 | Telemetry section in every report |
| v0.6.0 | Soft limits — maxSearchCalls, maxElapsedSeconds |
| v0.5.0 | `duck-duck-scrape` integration with retry & HTML fallback |
| v0.4.0 | Concurrent search & scrape (3.7× speedup) |
| v0.3.0 | Full pipeline integration tests |
| v0.2.0 | Tavily & Brave search providers |
| v0.1.0 | Initial release — Pi deep research extension |

## License

MIT
