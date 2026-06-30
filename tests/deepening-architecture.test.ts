import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Candidate 1 — DEFAULT_PRESETS + resolveProfile → profile-resolver", () => {
  it("DEFAULT_PRESETS is exported from profile-resolver", async () => {
    const { DEFAULT_PRESETS } = await import("../extension/profile-resolver.js");
    assert.ok(DEFAULT_PRESETS.default, "default preset exists");
    assert.ok(DEFAULT_PRESETS.fast, "fast preset exists");
    assert.ok(DEFAULT_PRESETS.deep, "deep preset exists");
    assert.equal(DEFAULT_PRESETS.default.breadth, 4);
  });

  it("resolveProfile is exported from profile-resolver", async () => {
    const { resolveProfile } = await import("../extension/profile-resolver.js");
    assert.equal(typeof resolveProfile, "function");
  });

  it("resolveProfile resolves default preset", async () => {
    const { resolveProfile, DEFAULT_PRESETS } = await import("../extension/profile-resolver.js");
    const result = resolveProfile({ name: "default" }, DEFAULT_PRESETS);
    assert.deepEqual(result, DEFAULT_PRESETS.default);
  });

  it("resolveProfile resolves custom profile", async () => {
    const { resolveProfile, DEFAULT_PRESETS } = await import("../extension/profile-resolver.js");
    const result = resolveProfile({ name: "custom", breadth: 10, depth: 5 }, DEFAULT_PRESETS);
    assert.equal(result.breadth, 10);
    assert.equal(result.depth, 5);
  });

  it("state-machine no longer owns DEFAULT_PRESETS — imports from profile-resolver", async () => {
    // state-machine imports DEFAULT_PRESETS from profile-resolver, doesn't export it
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "state-machine.ts"), "utf-8");
    assert.ok(
      src.includes(`from "./profile-resolver.js"`),
      "state-machine must import from profile-resolver",
    );
  });

  it("state-machine no longer exports resolveProfile", async () => {
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

  it("index.ts passes logger to ResearchStateMachine via ResearchContext", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "index.ts"), "utf-8");
    // ResearchStateMachine constructor should receive logger via ResearchContext
    const machineCalls = [...src.matchAll(/new ResearchStateMachine\(\{/g)];
    assert.ok(machineCalls.length >= 1, "must instantiate ResearchStateMachine");
    // At least one instantiation must include logger:
    const loggerInCtor = src.includes("logger:");
    assert.ok(loggerInCtor, "index.ts must pass logger to ResearchStateMachine via ResearchContext");
  });
});
