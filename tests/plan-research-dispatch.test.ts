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

describe("plan_research non-interactive mode", () => {
  it("errors when ctx.hasUI is false", () => {
    assert.ok(src.includes("!ctx.hasUI") || src.includes("!ctx?.hasUI"), "must check ctx.hasUI and error if false");
    assert.ok(
      src.includes("interactive") || src.includes("TUI") || src.includes("confirmation"),
      "error must mention interactive confirmation is required",
    );
  });

  it("has no confirm_research fallback message", () => {
    assert.ok(!src.includes("confirm_research"), "must not reference confirm_research tool");
  });

  it("has no non-interactive fallback message", () => {
    assert.ok(!src.includes("show user and ask for confirmation"), "must not have non-interactive fallback text");
  });
});
