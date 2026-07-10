# ADR-0023: Settings report — provenance trace on session start, run start, and in report

**Date:** 2026-07-10
**Status:** proposed

## Context

SettingsContext computes final values for all configuration fields but discards provenance — the user cannot tell whether `pdfExport: true` came from an environment variable, a settings file, or is the built-in default. Debugging configuration issues requires manually checking each source.

Additionally, the system has no opt-in way to surface current settings to the user at runtime. Users configure deep-research across three layers (env, `.pi/settings.json`, `~/.pi/agent/settings.json`) and have no visibility into which values are active.

## Decision

### 1. Provenance tracking in SettingsContext

Each field gets a parallel `*Source` field recording where the winning value came from:

```typescript
class SettingsContext {
  readonly reportsDir: string;          // unchanged for consumers
  readonly reportsDirSource: string;    // "default" | "env:DEEP_RESEARCH_REPORTS_DIR" | "file:~/.pi/agent/settings.json"

  readonly pdfExport: boolean;
  readonly pdfExportSource: string;

  readonly mindMap: boolean;
  readonly mindMapSource: string;

  readonly reportStyle: "narrative" | "subtopics";
  readonly reportStyleSource: string;

  readonly settingsReport: SettingsReportConfig;
  // ... and so on for all fields
}
```

Provenance format:
- `"default"` — built-in fallback
- `"env:<VAR_NAME>"` — environment variable
- `"file:<path>"` — settings.json, path relative to `$HOME` when possible (e.g. `"file:~/.pi/agent/settings.json"`)

**Why parallel fields, not `SettingWithSource<T>` wrapper:** avoids touching 10+ consumer call sites across `index.ts`, tools, orchestrator, session-state. Consumers stay unchanged. The new reporter module reads source fields for the table/log; everything else reads the existing raw-value fields.

### 2. New settings group: `settingsReport`

Three boolean toggles, all defaulting to `false`:

```json
{
  "deepResearch": {
    "settingsReport": {
      "onSessionStart": false,
      "onRunStart": false,
      "inReport": false
    }
  }
}
```

| Setting | Env var | Default | Behavior |
|---|---|---|---|
| `onSessionStart` | `DEEP_RESEARCH_SETTINGS_ON_SESSION_START` | `false` | Inject settings table into chat on `session_start` |
| `onRunStart` | `DEEP_RESEARCH_SETTINGS_ON_RUN_START` | `false` | Inject settings table at `plan_research` step 1 entry |
| `inReport` | `DEEP_RESEARCH_SETTINGS_IN_REPORT` | `false` | Append `## Settings` section after Telemetry in report |

Cascade: env → `.pi/settings.json` → `~/.pi/agent/settings.json` → `false`.

### 3. Settings reporter module

New module: `extension/settings-reporter.ts`. Exports:

```typescript
function buildSettingsTable(ctx: SettingsContext): string;
function buildSettingsJson(ctx: SettingsContext): object;
function writeSettingsLog(ctx: SettingsContext, logDir: string, opts: { trigger: "session_start" | "run_start"; runId?: string }): void;
```

**Table format** — markdown table with columns Setting | Value | Source, plus a separate Profiles table:

| Setting | Value | Source |
|---|---|---|
| reportsDir | `/home/user/reports` | `file:~/.pi/agent/settings.json` |
| pdfExport | `true` | `env:DEEP_RESEARCH_PDF_EXPORT` |
| brave.apiKey | `****` | `env:BRAVE_API_KEY` |
| settingsReport.onSessionStart | `false` | `default` |

**Profiles table** — no source column per user decision:

| Profile | Breadth | Depth | Concurrency | Max Search | Max Elapsed |
|---|---|---|---|---|---|
| default | 4 | 2 | 4 | - | - |

**Credentials** — values masked as `****`, source shown.

**JSON log** — written always (regardless of toggles) to `<logDir>/<runId>-settings-<timestamp>.json` for runs, `<logDir>/session-<timestamp>-settings.json` for session start. Contains full provenance data with masked credentials.

### 4. Wire points

| Trigger | Hook | File |
|---|---|---|
| `onSessionStart` | `pi.on("session_start", ...)` — same handler as ADR-0018 release monitor | `extension/index.ts` |
| `onRunStart` | Inside `plan_research` tool, first thing on step 1 entry | `tools/plan-research.ts` |
| `inReport` | Orchestrator post-processing, after telemetry append | `extension/research-run-orchestrator.ts` or `extension/report-assembly.ts` |
| Always log | Called from all three points above | `extension/settings-reporter.ts` |

### 5. Chat injection format

When `onSessionStart` or `onRunStart` is `true`, the table is injected via `pi.sendUserMessage()` with `deliverAs: "steer"`:

```
## Deep Research Settings

| Setting | Value | Source |
|---|---|---|
| ... | ... | ... |

### Profiles

| Profile | Breadth | Depth | Concurrency | Max Search | Max Elapsed |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |
```

### 6. Report section

When `inReport` is enabled, appended after Telemetry as `## Settings` with the same table format, minus the "Deep Research Settings" heading. No injection into chat — just appended to report text.

## Consequences

- **SettingsContext grows ~20 source fields** — one per existing field plus 3 `settingsReport` sub-fields. Tolerable — the constructor is the only place this complexity lives.
- **Non-breaking for consumers** — all existing fields retain their raw-value type. Zero changes required in tool handlers, orchestrator, state machine.
- **Opt-in** — all three toggles default to `false`. Zero user-visible change unless configured.
- **Always-on logging** — settings JSON always written to disk regardless of toggles. Enables post-mortem debugging without upfront opt-in.
- **Profiles omitted from source tracking** — per-field provenance inside merged profiles was deemed over-engineered.
- **Credentials masked everywhere** — `****` in table, configurable in JSON log (same mask rule).
