# Development

## Workflow

**Test-driven development is required.** Red-green-refactor in vertical slices: write one failing test → make it pass → refactor → repeat. Never write all tests first, then all code. Tests verify behavior through public interfaces, not implementation internals.

## Pre-commit checklist

Before committing any change, run the full quality gate:

```bash
npm run format        # auto-format with biome
npm run format:check  # verify formatting
npm run lint          # biome lint
npm test              # 429 tests via tsx
```

All four must pass. The linter and formatter catch issues the test runner doesn't.

## Test runner

```bash
npm test
# → cd extension && npx tsx --test ../tests/*.test.ts
```

## Linting & formatting

Uses [biome](https://biomejs.dev/). Configuration in `biome.json`.

```bash
npm run format        # auto-fix formatting
npm run format:check  # check only (CI)
npm run lint          # check lint rules
npm run lint:fix      # auto-fix lint (when safe)
npm run check         # format + lint combined
```

## Common lint rules

- `noExplicitAny` — use `Record<string, unknown>` for session entries and JSON-like blobs instead of `any`
- `noUnusedVariables` — prefix unused vars with `_`
- `useTemplate` — prefer template literals over string concatenation

## Git operations

- MUST always follow skill:git-skill to work with Git
- release MUST follow this steps:
  - merge `develop` branch to `release` branch (strict `release` without any version tags);
  - wait until new PR (made by GitHub workflow) from `release` branch to `master` branch is ready and inform user;
  - wait until user confirms this PR and it is merged to `master` branch;
  - wait until new release is created by GitHub workflow.
