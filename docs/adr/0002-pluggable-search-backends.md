# Pluggable search backends — SUPERSEDED by unified multi-engine search

> **Status:** Superseded. As of v0.8, the pluggable `SearchProvider` interface was replaced by a unified `searchWeb()` function supporting duckduckgo, brave, and searxng as first-class engines. Engines are selected in the Research Plan during prefilter, not in static settings. See ADR-0003.

The original decision (below) remains for historical context.

The Deep Research extension supports multiple web search providers behind a common interface. The default provider is **DuckDuckGo** — free, no API key, and works out of the box. Tavily and Brave Search are available as opt-in alternatives for users who need higher quality results and are willing to configure API keys.

**Considered Options**

- **Tavily only**: Mirror the `deep-research-codex` approach. Rejected because requiring a paid API key before the extension works at all creates unnecessary friction. Many users want to try deep research without signing up for a search API.

- **DuckDuckGo only**: Free and simple, but DDG's unofficial scraping approach is fragile (subject to HTML changes, rate limiting) and returns lower-quality snippets than dedicated search APIs. Rejected as the sole option because power users need better quality.

- **Pluggable backends (chosen)**: A `SearchProvider` interface with DuckDuckGo as fallback default. Users configure `searchProvider` and optional API keys in `~/.pi/settings.json`. The extension resolves the provider at runtime, falling back to DuckDuckGo if the configured provider is unavailable. This gives zero-config onboarding with an upgrade path for quality.

**Consequences**

- The `SearchProvider` interface must remain stable across backend additions. Adding a new provider (e.g., Serper, SearXNG) must not break existing configurations.
- DuckDuckGo scraping may break when DuckDuckGo changes its HTML structure. The extension should surface clear errors and suggest switching to Tavily or Brave when this happens.
- DuckDuckGo does not expose usage credits, so `plan_research` preliminary searches are genuinely free — reinforcing the Confirmation Gate boundary.
