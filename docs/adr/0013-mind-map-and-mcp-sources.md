# ADR-0013: Mind-map generation, MCP/local sources, and repository link

**Date:** 2026-07-02
**Status:** proposed

## Context

Three independent extensions to the Deep Research system:

1. **Mind-map visualization** — Generate Mermaid mind-map diagrams from research findings, both automatically at the end of a Research Run and standalone on any document.
2. **Repository link in Telemetry** — Include the extension's source repository alongside the version in every report's Telemetry section.
3. **MCP and local documents as information sources** — Treat MCP tools and local files as first-class information sources alongside web search engines during a Research Run.

## Decision

### 1. Mind-map generation

#### Settings

New setting: `deepResearch.mindMap` (boolean, default `false`). Controls only whether Research Runs auto-generate mind-maps. The standalone `mind_map` tool is always available.

**Cascade:** env var `DEEP_RESEARCH_MIND_MAP` → `.pi/settings.json` → `~/.pi/agent/settings.json` → built-in `false`.

#### Orchestrator-gated `mapping` phase

The mapping phase lives in the **Research Run Orchestrator**, not the state machine. The state machine remains unaware of mind-maps.

**Flow:**
1. State machine returns `done` with `draftReport`
2. Orchestrator checks `deepResearch.mindMap` setting AND `draftReport.length > 0`
3. If enabled: injects mapping prompt → agent responds with Mermaid → append `## Mind Map` to `draftReport` → truly done
4. If disabled: immediately done (current behavior unchanged)

**Injection prompt:** uses findings (structured data — insight text, source URL, citation, iteration) rather than full draft report. Findings carry richer per-token information for diagram generation.

**Output:** Mermaid `graph TD` block embedded as `## Mind Map` section in the markdown report. Renders in GitHub, VS Code, any Mermaid-aware viewer.

#### Standalone `mind_map` tool

Always registered regardless of `deepResearch.mindMap` setting:

```typescript
mind_map(topic: string, content: string, save_path?: string)
```

**Injection-based** (no direct LLM API). Tool injects: "Generate a Mermaid mind map `graph TD` for: {topic}. Content: {content}." Agent responds with Mermaid inline. Agent uses `edit`/`write` to save if `save_path` provided. Tool implementation is a thin prompt-wrapper.

### 2. Repository link in Telemetry

`readExtensionVersion()` renamed to `readExtensionMeta()` — returns `{ version, repoUrl }` by reading `version` and `repository.url` from root `package.json`.

**Telemetry row** added after version:

```markdown
| Pi Extension repository | https://github.com/timaliev/pi-deep-research |
```

Zero config. Source-of-truth is `package.json`.

### 3. MCP and local documents as information sources

#### Architecture: agent-in-the-loop within `doSearching`

No new phase. Enrichment happens inside the existing `seaching` phase. The state machine:

1. **Call 1:** Web search (sync via `searchWeb()`) → if `plan.sources` exists → inject MCP/local search prompt → return `{phase: "searching", inject: ...}` (flag `snapshot.searchingEnriched = true`)
2. **Call 2:** Agent responded with MCP/local raw text → capture text → pass as context to `extracting` → `snapshot.searchingEnriched = false`

Uses a new `searchingEnriched: boolean` flag on `ResearchSnapshot` to distinguish call 1 from call 2.

#### Plan structure

New optional field in `ResearchPlan`:

```typescript
sources?: {
  local?: { paths: string[] };
  mcp?: string[];  // server names, or ["*"] for all available
}
```

Backward-compatible: absent → web-only behavior unchanged.

#### Prefilter: agent discovers MCP servers

No prefilter code changes beyond the prompt template. The `buildPlanPrompt` shows `sources` as an optional field in the plan JSON template. Agent introspects its own `mcp__*` tools and populates `sources.mcp` with relevant server names. Agent also proposes `sources.local.paths` based on project structure.

#### Enriched searching injection prompt

```
## Supplemental Search

Web search found {N} results for {breadth} questions at depth {currentDepth}/{totalDepth}.

### Local: Search paths {paths}
Use `grep`, `find`, `read` to find relevant information.

### MCP: Use available tools
Use `mcp__*` tools to search. Available servers: {mcp servers from plan}.

### Response
Report under these headings:
## Local Findings
[raw text]
## MCP Findings
[raw text]

Do NOT repeat web search results. Only report new findings.
```

Agent responds with raw text under headings. Machine captures the raw text and passes it to extraction.

#### Finding structure extension

```typescript
interface Finding {
  text: string;
  sourceUrl: string;
  citation: string;
  iteration: number;
  source: "web" | "local" | "mcp";  // new field
}
```

**Tagging:** Machine tags findings, not the agent. The extraction prompt groups source material by type. Machine knows which section produced which findings and assigns `source` automatically.

#### Extraction prompt with multi-source context

`buildExtractionPrompt` extended with optional `localContext?: string` and `mcpContext?: string` params. Prompt presents per-source sections:

```
### Web Sources
[scraped pages]

### Local Documents  
[local raw text from agent response]

### MCP Data
[mcp raw text from agent response]

For each finding, include source type: "web", "local", or "mcp".
```

#### Telemetry extension

New rows in Telemetry table:

```markdown
| Local sources | {count} |
| MCP sources | {count} |
| Web sources | {count} |
```

#### Estimation

`estimatedCost` remains web search/scrape calls only. Local and MCP sources use agent tools (grep, read, mcp__*), not search API credits. A note is added to the estimation description.

## Consequences

### Mind-map

- **Opt-in by default** — costs extra tokens; disabled unless user enables
- **Standalone always available** — generate mind-maps on any content without enabling auto-generation
- **Orchestrator-gated** — state machine stays pure; mapping lives at the orchestration boundary
- **Non-breaking** — when `deepResearch.mindMap` is `false`, zero change to existing behavior

### Repository link

- **Zero config** — reads from `package.json`, no new settings
- **Single source of truth** — version and repo URL from same file, one call via `readExtensionMeta()`

### MCP/local sources

- **Agent-in-the-loop** — no MCP SDK dependency; reuses existing injection pattern
- **No new phase** — enrichment inside existing `searching` phase via `searchingEnriched` flag
- **Raw text pass-through** — MCP/local results sent as unstructured context to extraction; no fragile parsing
- **Machine-tagged findings** — source provenance (`web`/`local`/`mcp`) assigned by machine, not agent
- **Optional in plan** — backward-compatible; `sources` field absent → web-only behavior
- **Token cost** — one extra injection per depth iteration when sources present
- **No search credit consumption** — local and MCP bypass search APIs
