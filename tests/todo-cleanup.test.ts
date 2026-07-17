/**
 * Tests for TODO cleanup fixes — July 2026.
 *
 * 1. export_pdf uses basename for default output path
 * 2. prefilter-prompts show tiered subtopics counts (not stale "5–10")
 * 3. prefilter search uses all enabled engines, not just agent-chosen
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

// ─── Fix 1: export_pdf default path ────────────────────────

describe("export_pdf default output path", () => {
  it("strips directory from relative report_path and uses only basename", () => {
    const reportPath = "deep-research/reports/my-report.md";
    const reportsDir = "/tmp/reports";
    const outputPath = join(reportsDir, basename(reportPath).replace(/\.md$/, "") + ".pdf");
    assert.equal(outputPath, "/tmp/reports/my-report.pdf");
  });

  it("keeps basename intact for absolute paths too", () => {
    const reportPath = "/Users/me/reports/some-report.md";
    const reportsDir = "/tmp/reports";
    const outputPath = join(reportsDir, basename(reportPath).replace(/\.md$/, "") + ".pdf");
    assert.equal(outputPath, "/tmp/reports/some-report.pdf");
  });
});

// ─── Fix 2: prefilter-prompts tiered subtopics ──────────────

describe("prefilter prompts show tiered subtopics counts", () => {
  it("buildParamsPrompt mentions 5–7, 8–12, 12–20 and NOT stale 5–10", async () => {
    const { buildParamsPrompt } = await import("../extension/prefilter-prompts.js");
    const result = buildParamsPrompt(
      "test",
      { default: { breadth: 4, depth: 2, concurrency: 4 } },
      "default",
      "✅ duckduckgo",
    );
    assert.ok(result.includes("5–7") && result.includes("8–12") && result.includes("12–20"));
    assert.ok(!result.includes("5–10"), "old 5–10 text must be gone");
  });

  it("buildPlanPrompt no longer says 5–10", async () => {
    const { buildPlanPrompt } = await import("../extension/prefilter-prompts.js");
    const result = buildPlanPrompt({
      topic: "test",
      engines: ["duckduckgo"],
      profileName: "default",
      resolvedBreadth: 4,
      resolvedDepth: 2,
      resolvedConcurrency: 4,
      presets: { default: { breadth: 4, depth: 2, concurrency: 4 } },
      searchResults: [],
      scrapedContent: [],
    });
    assert.ok(!result.includes("5–10"), "buildPlanPrompt must not mention stale 5–10");
  });
});

// ─── Fix 3: prefilter search uses all enabled engines ───────

describe("prefilter preliminary search uses all enabled engines", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pi-test-search-engines-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("searches with all enabledEngines even when agent picks fewer", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    let capturedEngines: string[] = [];
    const manager = new PrefilterManager({
      searchFn: async (_q: string, _max: number, engines: any) => {
        capturedEngines = Array.isArray(engines) ? engines : [engines];
        return [];
      },
      scraper: { scrape: async () => ({ url: "", title: "", content: "" }) },
      artifactsDir: tmpDir,
      enabledEngines: ["duckduckgo", "tavily"],
      profileResolver: new ProfileResolver({}),
    });

    await manager.withParams("test", ["duckduckgo"], { name: "fast" });
    assert.deepEqual(
      capturedEngines,
      ["duckduckgo", "tavily"],
      "preliminary search must use all enabled engines, not just agent's single choice",
    );
  });

  it("falls back to agent-chosen engines when no enabledEngines configured", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    let capturedEngines: string[] = [];
    const manager = new PrefilterManager({
      searchFn: async (_q: string, _max: number, engines: any) => {
        capturedEngines = Array.isArray(engines) ? engines : [engines];
        return [];
      },
      scraper: { scrape: async () => ({ url: "", title: "", content: "" }) },
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    // No enabledEngines — must use agent's duckduckgo (free, no API key check)
    await manager.withParams("test", ["duckduckgo"], { name: "fast" });
    assert.deepEqual(capturedEngines, ["duckduckgo"]);
  });
});
