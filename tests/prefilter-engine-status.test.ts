import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("buildParamsPrompt engine availability", () => {
  it("buildEngineStatus exists in prefilter.ts", () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("buildEngineStatus"),
      "prefilter.ts must have buildEngineStatus method"
    );
  });

  it("buildParamsPrompt calls buildEngineStatus", () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"),
      "utf-8",
    );
    const promptMethod = src.match(/buildParamsPrompt[\s\S]*?return `[\s\S]*?`;/);
    assert.ok(promptMethod, "buildParamsPrompt must exist");
    assert.ok(
      promptMethod![0].includes("buildEngineStatus"),
      "buildParamsPrompt must call buildEngineStatus"
    );
  });

  it("engine status uses checkmark symbols", () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("✅") || src.includes("✓"),
      "engine status must use checkmark for available engines"
    );
    assert.ok(
      src.includes("❌") || src.includes("✗"),
      "engine status must use cross-mark for unavailable engines"
    );
  });

  it("duckduckgo always marked available", () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"),
      "utf-8",
    );
    // duckduckgo entry must have available: true
    const ddgLine = src.match(/duckduckgo[^}]*available:\s*true/);
    assert.ok(ddgLine, "duckduckgo must have available: true");
  });

  it("brave checks SearchProviderCredentials for apiKey", () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"),
      "utf-8",
    );
    const braveLine = src.match(/brave[^}]*get\(["']brave["']/);
    assert.ok(braveLine, "brave must check credentials via searchCred.get('brave', ...)");
  });
});
