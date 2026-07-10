# Development notes

## Test command

```bash
npm test
```

Runs full test suite via `cd extension && npx tsx --test ../tests/*.test.ts`.

## Lint command

```bash
npx biome check extension/ tests/
```

Auto-fix: `npx biome check --write extension/ tests/`
