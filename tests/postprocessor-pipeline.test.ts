/**
 * Architecture: PostProcessor pipeline — extract buildDoneResult into composable chain.
 * Pure refactor — no behavior change.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "research-run-orchestrator.ts"),
  "utf-8",
);

describe("PostProcessor pipeline", () => {
  it("orchestrator has PostProcessor interface", () => {
    assert.ok(
      src.includes("PostProcessor") || src.includes("postProcessor"),
      "must have PostProcessor concept",
    );
  });

  it("buildDoneResult iterates a pipeline", () => {
    assert.ok(
      src.includes("pipeline") || src.includes("processors"),
      "buildDoneResult must use a processor pipeline",
    );
  });
});
