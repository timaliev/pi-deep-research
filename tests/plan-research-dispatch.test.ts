/**
 * Architecture: plan_research dispatch — extract 4 handler methods.
 * Pure refactor — no behavior change, existing tests cover correctness.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "plan-research.ts"), "utf-8");

describe("plan_research dispatch — handler methods", () => {
  it("has handleStart method", () => {
    assert.ok(src.includes("handleStart"), "must have handleStart handler");
  });

  it("has handleWithParams method", () => {
    assert.ok(src.includes("handleWithParams"), "must have handleWithParams handler");
  });

  it("has handleContinue method", () => {
    assert.ok(src.includes("handleContinue"), "must have handleContinue handler");
  });

  it("has handleFinalize method", () => {
    assert.ok(src.includes("handleFinalize"), "must have handleFinalize handler");
  });

  it("execute() dispatches to handlers", () => {
    assert.ok(
      src.includes("handleStart(") &&
        src.includes("handleWithParams(") &&
        src.includes("handleContinue(") &&
        src.includes("handleFinalize("),
      "execute must call all 4 handlers",
    );
  });
});
