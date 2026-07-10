# ADR-0020: SettingsContext re-init on session_start + standalone tool defaults

**Date:** 2026-07-09
**Status:** proposed

## Context

`SettingsContext` is initialized once in the extension factory with `process.cwd()`. Pi's startup directory may differ from the project directory where `.pi/settings.json` lives. Result: local project settings are silently skipped, and the cascade silently falls through to global `~/.pi/agent/settings.json` or built-in defaults.

Additionally, standalone tools (`save_report`, `export_pdf`, `mind_map`) either don't use `SettingsContext` or have incomplete integration:

- `save_report`: uses `reportsDir` ✓ but affected by the cwd bug.
- `export_pdf`: receives `sendUserMessage` only. No output directory default from settings.
- `mind_map`: receives `sendUserMessage` only. No save path default from settings.
- `scrape_url`: no settings needed (pure HTTP fetch).
- `deep_web_search`: uses `searchCred` ✓ — credentials already cascade correctly.

## Decision

### 1. Re-init SettingsContext on every session_start

Replace `SettingsContext`'s `readonly` fields with mutable fields. Add a `reinit(cwd: string)` method that:

1. Re-reads `process.env` (all `DEEP_RESEARCH_*` vars) — env is re-evaluated, not cached from factory init
2. Re-reads `<cwd>/.pi/settings.json`
3. Re-reads `~/.pi/agent/settings.json`
4. Re-applies the full cascade (env → local → global → default) for **every** field — nothing is "read once and cached"
5. Mutates the existing singleton in-place — all consumers (tools, orchestrator, prefilter) see updated values automatically

Fields re-evaluated: `reportsDir`, `artifactsDir`, `defaultProfile`, `pdfExport`, `mindMap`, `reportStyle`, `profiles`, `credentials`.

Wire in `index.ts`:

```typescript
pi.on("session_start", (_event, ctx) => {
  settings.reinit(ctx.cwd);
});
```

On startup (factory time), the cascade still runs with `process.cwd()` — the first `session_start` will correct it to `ctx.cwd`.

### 2. Wire SettingsContext into export_pdf and mind_map

**export_pdf**: `createExportPdfTool` gains a `settings: SettingsContext` parameter. If `output_path` is not provided, default to:

```
settings.reportsDir / <report_filename>.pdf
```

where `<report_filename>` is derived from the input `report_path`'s basename (strip `.md`, append `.pdf`).

**mind_map**: `createMindMapTool` gains a `settings: SettingsContext` parameter. If `save_path` is not provided, default to:

```
settings.reportsDir / <topic-slug>.mmd
```

### 3. Document standalone tools in README

Add a "Standalone Tools" section to README.md with one example per tool, showing usage outside the deep research workflow.

## Consequences

- **Settings are session-scoped** — changing project directories, settings files, or environment variables between sessions works correctly. Pi's `/new` or `/resume` triggers a full re-read of `process.env`, `.pi/settings.json`, and global settings.
- **All cascade levels re-evaluated** — no field is "read once and cached." `credentials` (API keys from env + settings.json), `profiles` (merged presets), and all boolean/string fields are recalculated on each `session_start`.
- **Singleton mutation is safe** — all consumers hold a reference to the singleton. Re-initing the fields propagates to all tools without wiring changes.
- **Standalone tools produce predictable output paths** — `export_pdf` and `mind_map` respect the same `reportsDir` cascade as `save_report` and the research run.
- **One-time init at factory time still runs** — the factory initialization with `process.cwd()` serves as a reasonable starting point until the first `session_start` corrects it.
