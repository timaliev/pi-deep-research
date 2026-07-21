import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

describe("validateAndSavePlan", () => {
  let tmpDir: string;

  function makePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      topic: "test topic",
      goal: "test goal",
      researchQuestions: ["q1", "q2"],
      engines: ["duckduckgo"],
      profile: { name: "default" },
      scope: { include: "all", exclude: "none" },
      estimatedCost: { searchCalls: 4, scrapeCalls: 4, description: "~4" },
      ...overrides,
    };
  }

  function makeInput(plan: Record<string, unknown>, overrides: Partial<Record<string, unknown>> = {}) {
    return {
      planJson: JSON.stringify(plan),
      topic: (plan.topic as string) ?? "test",
      engines: (plan.engines as string[]) ?? ["duckduckgo"],
      profileName: (plan.profile as Record<string, string>)?.name ?? "default",
      artifactsDir: (overrides.artifactsDir as string) ?? tmpDir,
      enabledEngines: (overrides.enabledEngines as string[]) ?? [],
      profileNames: ["default", "fast", "deep"],
      reportStyle: "narrative",
    };
  }

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pi-test-validate-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves a valid plan and returns plan + artifactPath", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan();
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);

    assert.ok(result.ok, `expected ok, got error: ${(result as { error: string }).error}`);
    if (!result.ok) return;
    assert.equal(result.plan.topic, "test topic");
    assert.ok(result.planArtifactPath.endsWith("-prefilter.json"));
    assert.ok(existsSync(result.planArtifactPath));

    const raw = readFileSync(result.planArtifactPath, "utf-8");
    const artifact = JSON.parse(raw);
    assert.equal(artifact.plan.topic, "test topic");
    assert.equal(artifact.plan.researchQuestions.length, 2);
  });

  it("rejects invalid JSON", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const input = makeInput(makePlan());
    input.planJson = "not json";
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("JSON"));
  });

  it("rejects plan without topic", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ topic: "" });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("topic"));
  });

  it("rejects plan without goal", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ goal: undefined });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("goal"));
  });

  it("rejects plan without researchQuestions", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ researchQuestions: [] });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("researchQuestions"));
  });

  it("rejects plan without engines", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ engines: [] });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("engines"));
  });

  it("rejects invalid reportStyle", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ reportStyle: "invalid" });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("reportStyle"));
  });

  it("accepts valid narrative reportStyle", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ reportStyle: "narrative" });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(result.ok);
  });

  it("enforces engine allowlist — drops unlisted engines", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ engines: ["brave", "tavily"] });
    const input = makeInput(plan, { enabledEngines: ["duckduckgo"] });
    const result = await validateAndSavePlan(input);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.deepEqual(result.plan.engines, ["duckduckgo"]);
  });

  it("expands engines — adds missing enabled engines", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ engines: ["duckduckgo"] });
    const input = makeInput(plan, { enabledEngines: ["duckduckgo", "brave"] });
    const result = await validateAndSavePlan(input);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.ok(result.plan.engines.includes("brave"), "must expand to include brave");
    assert.ok(result.plan.engines.includes("duckduckgo"));
  });

  it("rejects invalid profile name", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ profile: { name: "nonexistent" } });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("profile.name"));
  });

  it("validates custom profile has breadth/depth/concurrency", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ profile: { name: "custom" } });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("breadth"));
  });

  it("accepts valid custom profile", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan({ profile: { name: "custom", breadth: 5, depth: 3, concurrency: 4 } });
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(result.ok);
  });

  // ─── JSON extraction from LLM output ──────────────────
  it("extracts plan from markdown json fence", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan();
    const wrappedJson = "```json\n" + JSON.stringify(plan) + "\n```";
    const input = makeInput(plan);
    input.planJson = wrappedJson;
    const result = await validateAndSavePlan(input);
    assert.ok(result.ok, `expected ok, got: ${(result as { error: string }).error}`);
  });

  it("extracts plan from bare JSON", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan();
    const input = makeInput(plan);
    const result = await validateAndSavePlan(input);
    assert.ok(result.ok);
  });

  it("extracts JSON object embedded in text with explanation", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan();
    const wrappedJson =
      "Here is the research plan:\n\n" + JSON.stringify(plan) + "\n\nLet me know if you need changes.";
    const input = makeInput(plan);
    input.planJson = wrappedJson;
    const result = await validateAndSavePlan(input);
    assert.ok(result.ok, `expected ok, got: ${(result as { error: string }).error}`);
  });

  it("rejects output without any JSON object", async () => {
    const { validateAndSavePlan } = await import("../extension/validate-and-save.js");
    const plan = makePlan();
    const input = makeInput(plan);
    input.planJson = "I cannot create a plan because the topic is too broad.";
    const result = await validateAndSavePlan(input);
    assert.ok(!result.ok);
    assert.ok((result as { error: string }).error.includes("JSON"));
  });
});
