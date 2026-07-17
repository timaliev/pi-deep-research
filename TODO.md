# Project TODO

## Next (ADR-0027: single-call prefilter)

- DONE: add PrefilterManager.next() unified entry point (ADR-0027). Removed estimate_research_cost tool. Updated SKILL.md Phase 3.
- TODO: make all prefilter errors self-recovering — never return phase:"error" to agent. Invalid JSON → re-inject parse prompt. Missing fields → re-inject with specific guidance. Skipped introspection → auto-inject introspection now. Already finalized → return existing plan_ready. No cached state → restart from start phase. All recovery within tool, zero agent decisions.
- TODO: fix getOrCreate to allow restart on error — currently reuses stale manager from session entry. New call with same topic after error must create fresh PrefilterManager.

## Remaining (ADR-0013: MCP/local sources)

- TODO: add `Finding.source` field (`"web"` | `"local"` | `"mcp"`) to `Finding` interface.
- TODO: add optional `sources?: { local?: { paths: string[] }, mcp?: string[] }` to `ResearchPlan` interface.
- TODO: implement enriched search in `doSearching()` — `searchingEnriched` flag, inject MCP/local prompt after web search, capture raw agent response text, pass to extraction as unstructured context.
- TODO: extend `buildExtractionPrompt` with optional `localContext` and `mcpContext` params — per-source sections in prompt, machine-tags findings by source section.
- TODO: add source-type breakdown rows (Web/Local/MCP counts) to `buildTelemetrySection()`.
- TODO: update `buildParamsPrompt` and `buildPlanPrompt` to mention MCP/local sources in prefilter flow.

## Done (July 2026)

All architecture review findings implemented (5 reviews, 19 findings). All bug fixes applied. All TODOs completed except ADR-0013.

See `docs/architecture-review-2026-07.md` for the full list.
