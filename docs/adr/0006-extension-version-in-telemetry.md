# ADR-0006: Extension version in report telemetry

**Date:** 2026-06-29
**Status:** accepted

## Context

Reports had no provenance — it was impossible to tell which extension version produced a given report. The `## Research Telemetry` table included Run ID, search/scrape counts, duration, and soft-limit status, but no version information.

## Decision

**Add a `Version` row to the research telemetry table.**

- `buildTelemetrySection(snapshot, extensionVersion?)` accepts an optional version string
- When provided, a `| Version | 0.13.1 |` row appears immediately after Run ID
- When omitted (backward compat), the row is absent

**Version source:** Read from root `package.json` at report-save time.

- `readExtensionVersion(pkgPath?)` — reads `version` field from package.json
- Defaults to `extension/../package.json` (root)
- Returns `undefined` when file missing, unparseable, or no `version` field

**Call site:** `index.ts` auto-save reads version each time before calling `buildTelemetrySection`.

## Consequences

- Every report now traceable to the exact extension version that produced it
- Backward compatible: old reports without version row remain valid markdown
- Minimal interface change: one optional string parameter
- Testable: `readExtensionVersion` accepts custom path for test isolation
