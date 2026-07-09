import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Candidate 1 — DEFAULT_PRESETS + ProfileResolver → profile-resolver", () => {
  it("DEFAULT_PRESETS is exported from profile-resolver", async () => {
    const { DEFAULT_PRESETS } = await import("../extension/profile-resolver.js");
    assert.ok(DEFAULT_PRESETS.default, "default preset exists");
    assert.ok(DEFAULT_PRESETS.fast, "fast preset exists");
    assert.ok(DEFAULT_PRESETS.deep, "deep preset exists");
    assert.equal(DEFAULT_PRESETS.default.breadth, 4);
  });

  it("ProfileResolver.resolve resolves default preset", async () => {
    const { ProfileResolver } = await import("../extension/profile-resolver.js");
    const resolver = new ProfileResolver({}, "default");
    const result = resolver.resolve({ name: "default" });
    assert.equal(result.breadth, 4);
    assert.equal(result.depth, 2);
  });

  it("ProfileResolver.resolve resolves custom profile", async () => {
    const { ProfileResolver } = await import("../extension/profile-resolver.js");
    const resolver = new ProfileResolver({}, "default");
    const result = resolver.resolve({ name: "custom", breadth: 10, depth: 5 });
    assert.equal(result.breadth, 10);
    assert.equal(result.depth, 5);
  });

  it("state-machine uses ProfileResolver instead of raw presets", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "state-machine.ts"), "utf-8");
    assert.ok(
      src.includes("profileResolver: ProfileResolver"),
      "state-machine must use ProfileResolver",
    );
    assert.ok(
      !src.includes("profilePresets"),
      "state-machine must not use raw profilePresets",
    );
  });

  it("state-machine no longer exports resolveProfile or DEFAULT_PRESETS", async () => {
    const sm = await import("../extension/state-machine.js");
    const exports = Object.keys(sm);
    assert.ok(!exports.includes("resolveProfile"), "resolveProfile should not be exported from state-machine");
    assert.ok(!exports.includes("DEFAULT_PRESETS"), "DEFAULT_PRESETS should not be exported from state-machine");
  });

  it("prefilter imports profile resolution from profile-resolver, not state-machine", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"), "utf-8");
    assert.ok(
      src.includes('from "./profile-resolver.js"'),
      "prefilter must import from profile-resolver",
    );
  });
});

describe("Candidate 2 — logger locality in ResearchStateMachine", () => {
  it("ResearchStateMachine creates logger internally", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "state-machine.ts"), "utf-8");
    // Logger should be created inside the module, not injected
    assert.ok(
      src.includes("new JsonlLogger"),
      "state-machine should create logger internally",
    );
  });

  it("ResearchContext includes optional logger (ADR-0011)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "state-machine.ts"), "utf-8");
    const ctxMatch = src.match(/interface ResearchContext[\s\S]*?\n\}/);
    assert.ok(ctxMatch, "ResearchContext interface must exist");
    const hasLogger = ctxMatch[0].includes("logger");
    assert.ok(hasLogger, `ResearchContext must include optional logger for injection`);
  });

  it("run_research uses tool factory and orchestrator, not inline state machine", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const srcIdx = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "index.ts"), "utf-8");
    const srcDeps = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "deps.ts"), "utf-8");
    const srcTool = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "run-research.ts"), "utf-8");
    // index.ts delegates to registerAllTools
    assert.ok(srcIdx.includes("registerAllTools"), "index.ts must use registerAllTools");
    // deps.ts imports createRunResearchTool
    assert.ok(srcDeps.includes("createRunResearchTool"), "deps.ts must use tool factory");
    // tools/run-research.ts uses ResearchRunOrchestrator
    assert.ok(srcTool.includes("ResearchRunOrchestrator"), "run-research tool must use orchestrator");
  });
});
