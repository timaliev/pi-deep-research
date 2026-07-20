/**
 * ADR-0028: plan_research subprocess prefilter.
 * Single { topic } call, no injections, subprocess for LLM steps.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "plan-research.ts"), "utf-8");

describe("plan_research ADR-0028 subprocess prefilter", () => {
  it("parameter schema has only topic field (optional for backward compat)", () => {
    assert.ok(src.includes("topic"), "must have topic field");
    const schemaStart = src.indexOf("Type.Object");
    const schemaBlock = src.slice(schemaStart, schemaStart + 300);
    assert.ok(!schemaBlock.includes("params_json"), "schema must NOT have params_json");
    assert.ok(!schemaBlock.includes("plan_json"), "schema must NOT have plan_json");
  });

  it("description mentions single call", () => {
    assert.ok(
      src.includes("single") || src.includes("once") || src.includes("auto"),
      "description must mention single-call pattern",
    );
  });

  it("does not have phase dispatch", () => {
    assert.ok(!src.includes("phase ==="), "must NOT have phase dispatch");
    assert.ok(!src.includes("awaiting_params"), "must NOT reference old phases");
    assert.ok(!src.includes("introspecting"), "must NOT reference old phases");
  });

  it("does not have parseAgentResponse or extractJson", () => {
    assert.ok(!src.includes("parseAgentResponse"), "must NOT have parseAgentResponse");
    assert.ok(!src.includes("extractJson"), "must NOT have extractJson");
  });

  it("does not use sessionManager for response parsing", () => {
    assert.ok(!src.includes("sessionManager.getEntries"), "must NOT read entries for agent response");
  });

  it("does not have injection via sendUserMessage for prefilter steps", () => {
    assert.ok(!src.includes('"steer"'), "must NOT inject steer messages for prefilter steps");
  });

  it("resolves engines/profile from settings", () => {
    assert.ok(
      src.includes("enabledEngines") || src.includes("defaultProfile"),
      "must resolve engines/profile from settings",
    );
  });

  it("uses PrefilterManager for validation and saving", () => {
    assert.ok(src.includes("PrefilterManager") || src.includes("finalize"), "must use PrefilterManager");
  });

  it("keeps TUI confirmation via confirmPlanDialog", () => {
    assert.ok(src.includes("confirmPlanDialog"), "must keep TUI confirmation");
  });

  it("errors when ctx.hasUI is false", () => {
    assert.ok(src.includes("hasUI"), "must check hasUI");
  });

  it("has no confirm_research references", () => {
    assert.ok(!src.includes("confirm_research"), "must not reference confirm_research tool");
  });
});
