---


## [0.17.2](https://github.com/timaliev/pi-deep-research/compare/v0.17.1..v0.17.2) - 2026-07-02

### Bug Fixes

- **(orchestrator)** replace local extractText with canonical extractTextContent - ([271c683](https://github.com/timaliev/pi-deep-research/commit/271c683050f46df3aa93a912545bca15d2376b4c)) - Tim Aliev
- install git-cliff as a dependency in release workflow - ([c8f62f9](https://github.com/timaliev/pi-deep-research/commit/c8f62f971b5c08a539edc351f122335960f4f56f)) - Tim Aliev

### Refactoring

- **(engines)** move DuckDuckGo implementation from web-search.ts to duckduckgo adapter - ([4de2a76](https://github.com/timaliev/pi-deep-research/commit/4de2a767389cc4af1434eb5b0bd86451d2370c4b)) - Tim Aliev
- **(engines)** move Brave implementation from web-search.ts to brave adapter - ([14a7760](https://github.com/timaliev/pi-deep-research/commit/14a77607e6fdcf842060b3358eeafec4215d64cb)) - Tim Aliev
- **(engines)** move Tavily implementation from web-search.ts to tavily adapter - ([8bef098](https://github.com/timaliev/pi-deep-research/commit/8bef098ab55a6e5d44e695f0d45f0bb1fd133dc7)) - Tim Aliev
- **(engines)** move SearXNG implementation from web-search.ts to searxng adapter - ([c744022](https://github.com/timaliev/pi-deep-research/commit/c744022e0e4c29cd4f9e333fe063d6bd401b6bd6)) - Tim Aliev
- **(engines)** move Yandex implementation from web-search.ts to yandex adapter - ([231477d](https://github.com/timaliev/pi-deep-research/commit/231477d9c47624fd1f682e1f2aabe633ecf0805a)) - Tim Aliev

### Documentation

- **(adr)** add ADR-0013 for mind-map, MCP/local sources, repo link - ([6d706e6](https://github.com/timaliev/pi-deep-research/commit/6d706e6164d925b081caa02e0e9c6d67bcb47357)) - Tim Aliev
- **(adr)** add profile listing in plan creation to ADR-0013 - ([6d31bac](https://github.com/timaliev/pi-deep-research/commit/6d31bac56364acb6ee6a03b054792257430d01ea)) - Tim Aliev
- **(adr)** add ADR-0014 for PDF export feature - ([7462fd0](https://github.com/timaliev/pi-deep-research/commit/7462fd012df09ba0b1329dbd4ebf378043399d20)) - Tim Aliev
- **(todo)** add unimplemented features from ADR-0013 and ADR-0014 - ([a41e656](https://github.com/timaliev/pi-deep-research/commit/a41e656d3329d4dca1991d001ad46e60be907349)) - Tim Aliev
- **(todo)** add diagnosed bugs, dead code, and smells sections - ([9ce8189](https://github.com/timaliev/pi-deep-research/commit/9ce81892d62bd142ca9016cb2b18f260c5bfed19)) - Tim Aliev
- **(todo)** add architecture improvement candidates C1-C5 - ([0056aad](https://github.com/timaliev/pi-deep-research/commit/0056aad999aeb1c5386e1e8cabd4df68efa6404c)) - Tim Aliev

### Tests

- **(ddg)** update stagger test paths after DDG extraction to engine adapter - ([f5e5e27](https://github.com/timaliev/pi-deep-research/commit/f5e5e276a51c01f220728654ae38127cd7727cf3)) - Tim Aliev

### Miscellaneous Chores

- remove artifacts and logs from repo, add to .gitignore - ([c1de570](https://github.com/timaliev/pi-deep-research/commit/c1de5700ef235da505c7450e12cd0edfa58f7ca2)) - Tim Aliev

### Other

- **(workflows)** refactor — deduplicate tests, changelog assembles header+bump+prior, release uses workflow_run - ([abe0884](https://github.com/timaliev/pi-deep-research/commit/abe0884caa269bc8bbca11fcb5fb3a3c0159ad3e)) - Tim Aliev
- refactor workflows — release-prep, release, test - ([f7087c0](https://github.com/timaliev/pi-deep-research/commit/f7087c0482132e6c5cfe47d188e85f72e1697e2b)) - Tim Aliev
- add release existence check and auto-cancel to release.yml - ([c87726f](https://github.com/timaliev/pi-deep-research/commit/c87726ff1ac2aa08b82d31d028b01578e77c21a4)) - Tim Aliev
