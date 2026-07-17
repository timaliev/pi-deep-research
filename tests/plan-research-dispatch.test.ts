/**
 * ADR-0027: plan_research single-call state machine.
 * Tests that the tool uses PrefilterManager.next() with auto-advancing loop.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "plan-research.ts"), "utf-8");

describe("plan_research ADR-0027 single-call protocol", () => {
  it("parameter schema has only topic field", () => {
    assert.ok(src.includes("topic: Type.String"), "must have topic as String");
    // Schema must not have params_json or plan_json as parameters
    const schemaStart = src.indexOf("Type.Object");
    const schemaBlock = src.slice(schemaStart, schemaStart + 300);
    assert.ok(!schemaBlock.includes("params_json"), "schema must NOT have params_json parameter");
    assert.ok(!schemaBlock.includes("plan_json"), "schema must NOT have plan_json parameter");
  });

  it("tool description mentions single call", () => {
    assert.ok(
      src.includes("single") || src.includes("once") || src.includes("auto-advance"),
      "description must mention single-call pattern",
    );
  });

  it("uses manager.next() for state dispatch", () => {
    assert.ok(src.includes("manager.next("), "execute must call manager.next()");
  });

  it("does not have 4-branch router", () => {
    assert.ok(!src.includes("params_json && !params.plan_json"), "must NOT have old params_json branch");
    assert.ok(
      !src.includes("!params.params_json && !params.plan_json && !params.topic"),
      "must NOT have old zero-param branch",
    );
    assert.ok(!src.includes("params.plan_json"), "must NOT have old plan_json branch");
  });

  it("does not have old handler methods", () => {
    assert.ok(!src.includes("handleStart"), "must NOT have handleStart");
    assert.ok(!src.includes("handleWithParams"), "must NOT have handleWithParams");
    assert.ok(!src.includes("handleContinue"), "must NOT have handleContinue");
    assert.ok(!src.includes("handleFinalize"), "must NOT have handleFinalize");
  });

  it("auto-advances from params to continue", () => {
    assert.ok(
      src.includes('"params"') && src.includes('"continue"'),
      "must auto-call continue after params to trigger introspection",
    );
  });

  it("errors when ctx.hasUI is false", () => {
    assert.ok(src.includes("!ctx.hasUI") || src.includes("!ctx?.hasUI"), "must check ctx.hasUI and error if false");
    assert.ok(
      src.includes("interactive") || src.includes("TUI") || src.includes("confirmation"),
      "error must mention interactive confirmation is required",
    );
  });

  it("has no confirm_research references", () => {
    assert.ok(!src.includes("confirm_research"), "must not reference confirm_research tool");
  });
});
