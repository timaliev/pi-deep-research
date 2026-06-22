---
name: deep-research
description: Autonomous deep web research. Plan research questions, search the web, scrape sources, extract findings, synthesize a structured markdown report. Use when the user asks for deep research, a web report, or to investigate a topic in depth.
---

# Deep Research

Run a multi-step autonomous web research workflow that produces a structured markdown report with cited sources.

## Setup

No setup required. The extension uses DuckDuckGo (free, no API key) for web search by default. To use Tavily or Brave Search for higher quality results, configure `deepResearch.searchProvider` in `~/.pi/settings.json`.

## Protocol

### Phase 1: Plan & Confirm

1. Call `plan_research` with the user's topic:
   ```
   plan_research({ topic: "<user's research topic>" })
   ```
2. The tool performs preliminary web searches and sends you a prompt with search results and scraped content.
3. Analyze the search results and produce a JSON research plan with this exact shape:
   ```json
   {
     "topic": "The research topic",
     "goal": "What this research aims to achieve",
     "researchQuestions": ["Question 1", "Question 2", "Question 3"],
     "scope": { "include": "What to include", "exclude": "What to exclude" },
     "estimatedCost": { "searchCalls": 12, "scrapeCalls": 8, "description": "~12 searches, ~8 scrapes" }
   }
   ```
4. Call `plan_research` again with your plan:
   ```
   plan_research({ topic: "<topic>", plan_json: "<your JSON>" })
   ```
5. **Guardrail:** If the result has `phase: "error"`, fix the JSON and retry.

6. Call `estimate_research_cost` to show the user the estimated cost:
   ```
   estimate_research_cost({ plan_artifact_path: "<path from plan_research result>" })
   ```

7. Present to the user:
   - The topic and research questions
   - The estimated cost breakdown
   - Ask: "Start deep research? This will use web search API calls."

8. **Guardrail:** Do NOT call `run_research` or any search/scrape tool until the user explicitly confirms.

### Phase 2: Research Loop

1. After user confirmation, call `run_research`:
   ```
   run_research({ plan_artifact_path: "<path to prefilter.json>" })
   ```

2. **Guardrail:** After EVERY `run_research` response, call `run_research` again immediately with NO parameters. The tool manages its own state machine.

3. Do NOT do anything else between calls — the tool injects prompts and you respond to them. Your job is to:
   - Process the injected prompt (extract findings, generate follow-up questions, write draft)
   - Call `run_research()` again

4. Stop when `phase` is `"done"`.

### Phase 3: Deliver

1. Report the saved report path to the user.
2. Offer to show the report content if the user wants to see it.

## Profiles

The default profile is `default` (breadth=4, depth=2). Use `profile` parameter for faster or deeper research:

```
run_research({ plan_artifact_path: "...", profile: "fast" })
run_research({ plan_artifact_path: "...", profile: "deep" })
```

## Output

Reports are saved to `./deep-research/reports/YYYY-MM-DD-topic-slug.md` in the current working directory. Artifacts go to `./deep-research/artifacts/`.

## Error Recovery

- **Search fails:** The tool skips failed searches and continues. If all searches fail, it returns empty results.
- **Scrape fails:** The tool skips failed scrapes. Findings will be based on search snippets only.
- **State lost:** If you see "no research state found", start over from Phase 1.
- **Rate limiting:** DuckDuckGo may rate-limit. Wait 30 seconds and retry the failed call.
