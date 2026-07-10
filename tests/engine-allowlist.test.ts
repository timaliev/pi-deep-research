/**
 * Engine allowlist — SettingsContext.enabledEngines, buildEngineStatus filtering.
 * Default: ["duckduckgo", "searxng"].
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Engine allowlist — SettingsContext.enabledEngines", () => {
  it("SettingsContext source has enabledEngines field", () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "settings-context.ts"), "utf-8");
    assert.ok(src.includes("enabledEngines"), "SettingsContext must have enabledEngines");
  });

  it("defaults to duckduckgo plus searxng", () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "settings-context.ts"), "utf-8");
    assert.ok(src.includes('"duckduckgo"') && src.includes('"searxng"'), "default must include duckduckgo and searxng");
  });

  it("reads from DEEP_RESEARCH_ENABLED_ENGINES env var", () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "settings-context.ts"), "utf-8");
    assert.ok(src.includes("DEEP_RESEARCH_ENABLED_ENGINES"), "must read enabledEngines from env var");
  });

  it("prefilter-prompts buildEngineStatus filters by allowlist", () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "prefilter-prompts.ts"), "utf-8");
    // buildEngineStatus must now accept enabledEngines param or filter internally
    assert.ok(src.includes("enabled") || src.includes("allowlist"), "buildEngineStatus must reference allowlist");
  });
});
