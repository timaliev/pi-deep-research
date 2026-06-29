# ADR-0010: DEFAULT_PRESETS + resolveProfile ownership

**Date:** 2026-06-29
**Status:** accepted
**Supersedes:** ADR-0004 (in part — moves preset ownership but preserves ProfileResolver semantics)

## Context

`DEFAULT_PRESETS` was defined in `state-machine.ts` and imported by `profile-resolver.ts` (which merges user overrides into it). The profile-resolver consumed what the state-machine produced — a layering inversion. Additionally, `prefilter.ts` imported both `ProfileResolver` and the state-machine's `resolveProfile`/`DEFAULT_PRESETS` as a fallback path when no ProfileResolver was available, creating a double-dependency on profile resolution.

## Decision

**Move `DEFAULT_PRESETS` and `resolveProfile` to `profile-resolver.ts` — the module that consumes and extends them.**

`profile-resolver.ts` now owns:
- `DEFAULT_PRESETS` — the built-in profile presets (`default`, `fast`, `deep`)
- `resolveProfile(planProfile, presets?)` — pure function resolving a plan profile to a concrete `ResearchProfile`

`state-machine.ts` imports both from `profile-resolver.ts`, no longer exports them.

`prefilter.ts` imports `resolveProfile` and `DEFAULT_PRESETS` from `profile-resolver.ts` (alongside `ProfileResolver`), eliminating the state-machine dependency for profile resolution.

`index.ts` no longer imports `DEFAULT_PRESETS` from state-machine.

## Consequences

- **Locality:** profile config lives in one module (profile-resolver)
- **Deletion test:** prefilter's fallback path collapsed to a single `resolveProfile` call from the canonical module
- **Backward incompatibility:** `resolveProfile` and `DEFAULT_PRESETS` are no longer exported from `state-machine.ts` — callers must import from `profile-resolver.ts`
- **No semantic change:** `resolveProfile` behavior is identical
