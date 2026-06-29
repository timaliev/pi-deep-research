# Project to do list

Note to agent: after each item is implemented and tested change `TODO:` into `DONE:`.

- DONE: use `deepResearch.searchProviders` field from settings.json to find API keys and other parameters for search engines.
- TODO: Write extension version from `./package.json` into each report statistics.
- TODO: if `plan.engines` contains more then one entry, distribute search requests evenly between those search engines.
- TODO: before running any web search requests build a queue of such a requests (each with random delay between sequential request if it is DDG or any other free engine) and then run them respecting delay. Keep queue as a JSON-file in `artifacts` directory for later post-mortem analysis.
- TODO: ensure that `## Research Telemetry` section is appended to each report at the end of file.
- TODO: include all artifacts files pertaining to the report as reference links in `## Research Telemetry` section of each report.
- TODO: read `https://api-dashboard.search.brave.com/app/documentation/web-search/get-started` and implement `brave` web search accordingly.
- TODO: add GitHub workflow for release, so only after successful tests pass release can be created.
