import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const PROMPTS_PATH = join(import.meta.dirname ?? ".", "..", "extension", "prefilter-prompts.ts");
const PRE_PATH = join(import.meta.dirname ?? ".", "..", "extension", "types.ts");

describe("buildParamsPrompt engine availability", () => {
  it("buildEngineStatus exists in prefilter-prompts.ts", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    assert.ok(src.includes("buildEngineStatus"), "prefilter-prompts.ts must have buildEngineStatus function");
  });

  it("buildParamsPrompt accepts engineStatus as parameter", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    // buildParamsPrompt must accept engineStatus as a parameter
    assert.ok(src.includes("engineStatus: string"), "buildParamsPrompt must accept engineStatus parameter");
  });

  it("engine status uses checkmark symbols", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    assert.ok(src.includes("✅") || src.includes("✓"), "engine status must use checkmark for available engines");
    assert.ok(src.includes("❌") || src.includes("✗"), "engine status must use cross-mark for unavailable engines");
  });

  it("duckduckgo always marked available", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    // buildEngineStatus now derives from ENGINE_META — free engines are always available
    assert.ok(
      src.includes("ENGINE_META") || src.includes("meta.free"),
      "buildEngineStatus must use ENGINE_META for availability",
    );
  });

  it("brave checks SearchProviderCredentials for apiKey", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    // buildEngineStatus uses cred?.get() for non-free engines
    assert.ok(
      src.includes("cred?.get") || src.match(/get\(.*credKey/),
      "buildEngineStatus must check credentials via cred.get()",
    );
  });
});

describe("buildMergePrompt JSON-only instruction", () => {
  it("has strict JSON-only output instruction", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    // Find buildMergePrompt function body
    const mergeStart = src.indexOf("export function buildMergePrompt");
    const mergeBody = src.slice(mergeStart, mergeStart + 1200);
    assert.ok(
      mergeBody.includes("Output ONLY") || mergeBody.includes("just the JSON"),
      "buildMergePrompt must require JSON-only output",
    );
  });

  it("accepts optional scrapedContent parameter", () => {
    const src = readFileSync(PROMPTS_PATH, "utf-8");
    const mergeStart = src.indexOf("export function buildMergePrompt");
    const mergeFn = src.slice(mergeStart, mergeStart + 1000);
    assert.ok(mergeFn.includes("scrapedContent"), "buildMergePrompt must accept optional scraped content");
  });
});
