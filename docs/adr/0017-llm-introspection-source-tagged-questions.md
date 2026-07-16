# ADR-0017: LLM introspection + source-tagged research questions

**Date:** 2026-07-09
**Status:** accepted (except Q8 — runtime consumption of questionMetadata, tracked in TODO.md)

## Context

The current prefilter flow is web-search-first: Phase 2 runs a preliminary web search, injects results to the agent, and the agent produces a Research Plan. The LLM's internal trained knowledge is never explicitly consulted — it only influences the plan indirectly through the agent's analysis of web results.

This means:
- Topics the LLM already knows with high confidence are not distinguished from new web discoveries
- Contradictions between internal knowledge and web sources are not surfaced
- Debatable facts are not flagged for post-report analysis
- The subtopics report style caps at 10 topics even for complex research with many questions

## Decision

### Phase 2 protocol change: LLM introspection round-trip

Add an extra turn to Phase 2 of `plan_research`:

```
Turn 1: plan_research({ topic, params_json })
  → tool injects: "Propose top-level topics from your internal knowledge.
                   Include confidence rating (low/medium/high) and importance
                   (critical/important/supplementary) for each. Respond with
                   structured markdown."
  → agent responds with LLM knowledge topics

Turn 2: plan_research()  [no params — tool detects introspection response]
  → tool runs preliminary web search
  → tool injects merged prompt: LLM topics + web results
  → agent merges, tags sources, flags contradictions, creates plan JSON
```

**State tracking:** A new `introspectionDone` flag on `PrefilterManager` distinguishes Turn 1 from Turn 2. The LLM topics are cached in the manager instance for the merge step.

### LLM knowledge topic format

Agent responds with structured markdown (parsed like existing `extractQuestions`):

```
## LLM Knowledge Topics

1. AGI Timeline
   Confidence: medium
   Importance: critical
   Key claim: Most experts predict AGI within 10-30 years.
   Uncertainty: Timeline depends on compute scaling breakthroughs.

2. AGI Safety
   Confidence: high
   Importance: critical
   ...
```

The tool extracts topic names, confidence, importance, key claims, and uncertainty from this format.

### Merge injection (Turn 2)

The merge prompt includes:

```
## LLM Knowledge Topics
[topics from internal knowledge, with confidence/importance tags]

## Preliminary Web Search Results
[search results + scraped content]

## Instructions
1. Merge topics from both sources
2. Tag each topic with source: "web", "internal", or "both"
3. Rate importance and question validity of each
4. Flag contradictions between internal knowledge and web sources
5. Flag debatable facts that need validation
6. Produce final Research Plan JSON with questionMetadata
```

### Research Plan schema extension

New optional field:

```typescript
questionMetadata?: Record<string, {
  source: "web" | "internal" | "both";
  confidence: "low" | "medium" | "high";
  importance: "critical" | "important" | "supplementary";
  contradictionOf?: string; // reference to conflicting topic/question
  debatableFact?: string;   // the specific fact under debate
}>
```

**Runtime consumption:** Metadata is passive — it enriches plan creation but is not consumed by the state machine at runtime. The agent already used it to curate questions. This may be revisited (see Future Decisions below).

### Post-report contradiction analysis

After the state machine reaches `done`:

1. **Orchestrator** (same pattern as mind-map gating): checks if any findings or question metadata contain contradiction flags
2. **Injection**: agent receives the full report text + flagged contradictions + debatable facts from question metadata
3. **Agent responds** with a `## Contradictions & Debatable Facts` section
4. **Appended** to the report before save

This lives in `ResearchRunOrchestrator`, not the state machine. The state machine is unaware of contradiction analysis.

### Tracking contradictions in findings

Contradictions are tracked through the extraction prompt, not new state fields. The extraction prompt for each iteration asks the agent to note "if this finding contradicts a previous finding or a web source." These are captured inline in finding text (e.g., "CONTRADICTION with [source]: …").

The orchestrator scans findings for contradiction markers and includes them in the post-report analysis prompt.

### Subtopics topic count tiers

Extend the topic count guidance in the subtopics drafting prompt:

| Research questions | Suggested topic count |
|---|---|
| 0-4 | 5-7 thematic sections |
| 5-7 | 8-12 thematic sections |
| 8+ | 12-20 thematic sections |

Previously hardcoded to `5-7` or `8-10`.

## Consequences

- **Extra round-trip** in Phase 2: one additional agent turn before plan creation
- **Prompt load**: merge prompt is larger (LLM topics + web results + instructions) — manageable with 2 scraped pages at 800 chars each
- **Backward compatible**: `questionMetadata` is optional; absent → current behavior unchanged
- **No new state machine phase**: introspection lives in prefilter, contradiction analysis lives in orchestrator
- **No new Finding fields**: contradictions are plain text in finding text, not structured data

## Future Decisions

- **Question 8 — Runtime consumption of questionMetadata**: Currently metadata is passive. Future work may use it to prioritize searches (critical questions get more depth), enrich extraction prompts with expected confidence, or validate internal-knowledge claims against web findings at runtime.
