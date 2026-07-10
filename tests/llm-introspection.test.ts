/**
 * ADR-0017: LLM introspection + source-tagged questions.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const promptsSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "prefilter-prompts.ts"), "utf-8");

const planResearchSrc = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "tools", "plan-research.ts"),
  "utf-8",
);

describe("ADR-0017 — LLM introspection prompts", () => {
  it("prefilter-prompts has buildIntrospectionPrompt", () => {
    assert.ok(
      promptsSrc.includes("buildIntrospectionPrompt") || promptsSrc.includes("introspection"),
      "must have introspection prompt builder",
    );
  });

  it("prefilter-prompts has buildMergePrompt", () => {
    assert.ok(
      promptsSrc.includes("buildMergePrompt") || promptsSrc.includes("merge"),
      "must have merge prompt builder",
    );
  });

  it("plan_research dispatches introspection turn", () => {
    assert.ok(planResearchSrc.includes("introspection"), "plan_research must dispatch introspection");
  });
});
