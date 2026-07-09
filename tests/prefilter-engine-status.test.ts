import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const PROMPTS_PATH = join(import.meta.dirname ?? ".", "..", "extension", "prefilter-prompts.ts");
const PRE_PATH = join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts");

describe("buildParamsPrompt engine availability", () => {
  it("buildEngineStatus exists in prefilter-prompts.ts", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    assert.ok(src.includes("buildEngineStatus"), "prefilter-prompts.ts must have buildEngineStatus function");
  });

  it("buildParamsPrompt accepts engineStatus as parameter", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    // buildParamsPrompt must accept engineStatus as a parameter
    assert.ok(src.includes("engineStatus: string"), "buildParamsPrompt must accept engineStatus parameter");
    // prefilter.ts calls buildEngineStatus and passes it to buildParamsPrompt
    const preSrc = readFileSync(PRE_PATH, "utf-8");
    assert.ok(preSrc.includes("buildEngineStatus"), "prefilter.ts must call buildEngineStatus");
    assert.ok(preSrc.includes("buildParamsPrompt"), "prefilter.ts must call buildParamsPrompt");
  });

  it("engine status uses checkmark symbols", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    assert.ok(src.includes("✅") || src.includes("✓"), "engine status must use checkmark for available engines");
    assert.ok(src.includes("❌") || src.includes("✗"), "engine status must use cross-mark for unavailable engines");
  });

  it("duckduckgo always marked available", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    const ddgLine = src.match(/duckduckgo[^}]*available:\s*true/);
    assert.ok(ddgLine, "duckduckgo must have available: true");
  });

  it("brave checks SearchProviderCredentials for apiKey", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    const braveLine = src.match(/brave[^}]*get\(["']brave["']/);
    assert.ok(braveLine, "brave must check credentials via cred.get('brave', ...)");
  });
});
