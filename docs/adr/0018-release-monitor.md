# ADR-0018: Release monitor on session start

**Date:** 2026-07-09
**Status:** accepted

## Context

Users install pi-deep-research via manual cloning or git pull. There is no npm package, no auto-update mechanism, and no in-app notification when a new version is released. Users discover updates by watching the GitHub repo or reading the CHANGELOG — easily missed.

## Decision

### Release check on session start

On every `session_start` event, the extension checks GitHub for a newer release. The check is:

1. **Gated by 6-hour cooldown** — a module-level `lastCheck` timestamp prevents excessive API calls. First `session_start` in 6 hours triggers the check; subsequent events within the window are no-ops.
2. **Unauthenticated GitHub API** — `GET /repos/timaliev/pi-deep-research/releases/latest` with `User-Agent: pi-deep-research/<version>`. No auth token needed for a public repo. Rate limit: 60 req/hour for unauthenticated requests. One check per 6 hours → 4 calls/day → well within limits.
3. **Network failure → silent skip** — if GitHub is unreachable, the check fails silently. No error message, no retry. The user experiences zero impact.
4. **Version comparison** — compare GitHub `tag_name` (strip leading `v` prefix if present) against local `version` from root `package.json`. Use semver comparison: `gt(latest, local)`.
5. **Notification** — only if newer version detected. Inject via `pi.sendUserMessage()` with `deliverAs: "steer"`:

```
## Deep Research Update Available

v0.23.0 is available (you have v0.22.0).

To upgrade:
- cd to your extension directory
- git pull
- (restart pi or run /reload)

[View release notes](https://github.com/timaliev/pi-deep-research/releases/tag/v0.23.0)
```

### Implementation

Module: `extension/release-monitor.ts`. Exports one function:

```typescript
export async function checkForNewRelease(sendUserMessage: (msg: string, opts: any) => void): Promise<void>
```

Wired in `index.ts` via:

```typescript
pi.on("session_start", () => checkForNewRelease(pi.sendUserMessage.bind(pi)));
```

### Dependencies

- `node:https` — built-in, for the GitHub API call
- `node:fs` — built-in, for reading local `package.json`
- No external semver library — use simple `major.minor.patch` integer comparison; GitHub tag format is predictable

## Consequences

- **One HTTP request per 6 hours** — negligible overhead
- **Silent on failure** — no detection of connectivity issues, but also no user-facing errors
- **Cooldown is per-process** — restarting pi resets the timer. Acceptable — restarting is rare
- **Version comparison is simple string-based** — assumes `v0.22.0` format. Won't match prerelease tags or non-standard formats. If GitHub tag doesn't match the expected pattern, skip silently
