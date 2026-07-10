/**
 * Architecture: orchestrator runAndPersist — deduplicate handleFirstCall/handleSubsequentCall.
 * Pure refactor — no behavior change.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "research-run-orchestrator.ts"), "utf-8");

describe("orchestrator runAndPersist dedup", () => {
  it("has runAndPersist method", () => {
    assert.ok(src.includes("runAndPersist"), "must have runAndPersist method");
  });

  it("handleFirstCall uses runAndPersist", () => {
    const firstMatch = src.match(/handleFirstCall[\s\S]*?^ {2}\}/m);
    assert.ok(firstMatch, "handleFirstCall must exist");
    assert.ok(firstMatch[0].includes("runAndPersist"), "handleFirstCall must call runAndPersist");
  });

  it("handleSubsequentCall uses runAndPersist", () => {
    const subMatch = src.match(/handleSubsequentCall[\s\S]*?^ {2}\}/m);
    assert.ok(subMatch, "handleSubsequentCall must exist");
    assert.ok(subMatch[0].includes("runAndPersist"), "handleSubsequentCall must call runAndPersist");
  });
});
