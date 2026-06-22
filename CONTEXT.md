# Deep Research for Pi

A Pi extension and skill that provides autonomous deep web research — planning research questions, searching the web, scraping sources, extracting findings, and synthesizing a structured markdown report — all using the user's current Pi LLM model.

## Language

**Deep Research**:
An autonomous multi-step research workflow: plan research questions → search → scrape → extract findings → recurse for depth → synthesize final report. Activated when the user asks Pi to research a topic, collect a web report with sources, or generate a markdown research report.
_Avoid_: web search, web report (these are individual steps, not the whole workflow)

**Prefilter**:
The initial planning phase that analyzes a raw user query, performs 2–3 preliminary web searches, and produces a structured Research Plan (JSON). Does not produce the final report. Corresponds to `plan_research` tool.
_Avoid_: planning, plan generation, query pre-processing

**Research Plan**:
A JSON artifact produced by `plan_research` containing: topic, goal, research questions (array), scope (include/exclude), estimated cost breakdown, and the normalized web query. Stored as `prefilter.json` in `./deep-research/artifacts/`. Serves as the canonical input for `run_research`.
_Avoid_: plan document, research brief, query template

**Research Run**:
A single execution of the `run_research` state machine from plan to report. Has a unique `runId` (timestamp-based) and produces artifacts: report, telemetry, log. Multiple runs can use the same Research Plan.
_Avoid_: execution, workflow run, research job

**Phase**:
A discrete state inside the `run_research` or `plan_research` state machine. The tool advances through phases (`searching → extracting → questioning → drafting → saving → done`) across multiple invocations, driven by the agent calling the tool repeatedly. Each invocation may advance one or more phases.
_Avoid_: step, stage, iteration

**Injection**:
A message sent by the extension tool into the Pi agent conversation via `pi.sendUserMessage()`, containing a prompt that asks the agent to perform a reasoning step (e.g., "Extract findings from this content", "Generate follow-up questions"). The tool cannot call the LLM directly — it must inject prompts and wait for the agent to respond in the next turn.
_Avoid_: prompt injection, steer message, follow-up prompt

**Finding**:
A single extracted insight from scraped web content, comprising the insight text, a source URL, a citation quote, and the iteration number in which it was discovered. Findings accumulate across all depth iterations and feed into the final report.
_Avoid_: learning, fact, observation, note

**Iteration**:
One level of the recursive research depth. Each iteration: search N queries (breadth) → scrape top results → extract findings → generate follow-up questions for the next iteration. The number of iterations is controlled by the `depth` parameter in the Research Profile.
_Avoid_: level, recursion step, pass

**Research Profile**:
A named set of parameters controlling the research budget and thoroughness: `breadth` (queries per level), `depth` (recursion levels), `concurrency` (parallel searches). Examples: `default` (4/2/4), `fast` (2/1/2), `deep` (6/3/4). Configured in `~/.pi/settings.json` under `deepResearch.profiles`.
_Avoid_: config preset, run configuration, research mode

**Search Provider**:
A pluggable backend that executes web search queries. The extension supports multiple implementations (DuckDuckGo, Tavily, Brave Search) selected via `searchProvider` in settings. DuckDuckGo is the default — free, no API key required, zero-config.
_Avoid_: retriever, search engine, search backend

**Confirmation Gate**:
The boundary between free operations (prefilter/planning) and paid operations (full research). The agent must present the Research Plan and estimated cost to the user and receive explicit approval before calling `run_research`. Enforced by skill instructions, not programmatically.
_Avoid_: approval step, user consent, cost check

**Soft Limit**:
A runtime constraint that caps resource usage during a Research Run. When triggered, the state machine reduces search intensity and skips deeper recursion levels. Limits: `maxSearchCalls`, `maxElapsedSeconds`. Configured in settings. The run still completes — it just becomes shallower.
_Avoid_: hard limit, quota, budget cap

**Telemetry**:
Structured usage data recorded during a Research Run: search API call count, scrape call count, phase durations, and (when available) LLM token usage. Saved as `*-telemetry.json` in `./deep-research/logs/` and appended as a summary table to the final report.
_Avoid_: analytics, metrics, usage report
