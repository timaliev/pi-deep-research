# Plan-driven parameters: engines and profile negotiated in prefilter

The Research Plan controls all runtime parameters — search engines, depth, breadth, concurrency. These are negotiated between the agent and user during the prefilter phase, not configured in static settings.

**Considered Options**

- **Settings-driven**: Engines and profile configured in `~/.pi/settings.json`, never surfaced to the agent or user during planning. Used in v0.x. Rejected because: (a) user must leave the Pi interface to change settings, (b) no negotiation — one-size-fits-all for every research topic, (c) settings don't travel with the plan artifact.

- **Runtime overrides**: Plan stored one set of params, `run_research` accepted overrides. Rejected because: dual authority — plan says one thing, runtime override says another. Harder to reason about, easier to misconfigure.

- **Plan-driven (chosen)**: All parameters live in the Research Plan JSON. Three-step prefilter: (1) agent proposes engines + profile, (2) preliminary search runs with chosen engines, (3) agent writes full plan. `run_research` reads everything from the plan — no overrides, no runtime switches. The plan is the single source of truth.

**Consequences**

- The `plan_research` tool requires three calls instead of two: `{topic}` → `{topic, params_json}` → `{topic, plan_json}`.
- `estimate_research_cost` reads profile from plan, not from a runtime parameter.
- `run_research` no longer accepts a `profile` parameter — it's locked in the plan.
- API key checks happen during prefilter step 2. If `BRAVE_API_KEY` is missing when brave is selected, the agent is warned and must retry or switch engines.
- Profile presets (`default`, `fast`, `deep`) are hardcoded in the extension but overridable via `settings.json`. Custom profiles specify `breadth`, `depth`, `concurrency` directly in the plan.
- Graceful degradation at runtime: if a configured engine's API key is unavailable, it silently falls back to duckduckgo (logged).
