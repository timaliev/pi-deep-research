/**
 * Engine allowlist enforcement — programmatic filtering at all entry points.
 * Ensures the LLM cannot override settings-configured engine restrictions.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PrefilterManager } from "../extension/prefilter.js";
import type { ScrapedPage, Scraper } from "../extension/scraper.js";
import type { WebSearchResult } from "../extension/search/web-search.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-allowlist-enforce");

function mockSearchFn(results: WebSearchResult[] = []) {
  return async () => results;
}
function mockScraper(): Scraper {
  return {
    async scrape() {
      throw new Error("no mock");
    },
  };
}

const MOCK_RESULTS: WebSearchResult[] = [
  { title: "Test", url: "https://example.com", snippet: "test", engine: "duckduckgo" },
];

describe("Engine allowlist enforcement", () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("withParams() — agent's engine choice", () => {
    it("filters out engines not in the allowlist", async () => {
      const manager = new PrefilterManager({
        searchFn: mockSearchFn(MOCK_RESULTS),
        scraper: mockScraper(),
        artifactsDir: TEST_DIR,
        enabledEngines: ["duckduckgo", "tavily"],
      });

      const result = await manager.withParams("test", ["duckduckgo", "brave", "tavily"], { name: "fast" });
      // brave should be dropped — only duckduckgo and tavily survive
      assert.equal(result.engines!.length, 2);
      assert.ok(result.engines!.includes("duckduckgo"));
      assert.ok(result.engines!.includes("tavily"));
      assert.ok(!result.engines!.includes("brave"), "brave must be filtered out");
    });

    it("falls back to duckduckgo when all engines are filtered", async () => {
      const manager = new PrefilterManager({
        searchFn: mockSearchFn(MOCK_RESULTS),
        scraper: mockScraper(),
        artifactsDir: TEST_DIR,
        enabledEngines: ["tavily"],
      });

      const result = await manager.withParams("test", ["brave", "yandex"], { name: "fast" });
      assert.equal(result.engines!.length, 1);
      assert.equal(result.engines![0], "duckduckgo");
    });

    it("passes through when allowlist is empty (no restriction)", async () => {
      const manager = new PrefilterManager({
        searchFn: mockSearchFn(MOCK_RESULTS),
        scraper: mockScraper(),
        artifactsDir: TEST_DIR,
      });

      const result = await manager.withParams("test", ["brave", "yandex"], { name: "fast" });
      assert.equal(result.engines!.length, 2);
    });
  });

  describe("finalize() — plan validation", () => {
    it("freezes allowed engines into the plan", async () => {
      const manager = new PrefilterManager({
        searchFn: mockSearchFn(MOCK_RESULTS),
        scraper: mockScraper(),
        artifactsDir: TEST_DIR,
        enabledEngines: ["duckduckgo"],
      });

      await manager.withParams("test", ["duckduckgo", "brave"], { name: "fast" });
      const plan = JSON.stringify({
        topic: "test",
        goal: "test",
        researchQuestions: ["q1"],
        engines: ["duckduckgo", "brave"],
        profile: { name: "fast" },
        scope: { include: "", exclude: "" },
        estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "1" },
      });
      const result = await manager.finalize("test", plan);

      assert.equal(result.phase, "plan_ready");
      assert.equal(result.plan!.engines.length, 1);
      assert.equal(result.plan!.engines[0], "duckduckgo");
      assert.deepEqual(result.plan!.enabledEngines, ["duckduckgo"], "must freeze allowlist into plan");
    });

    it("still succeeds when plan has only disallowed engines (fallback to duckduckgo)", async () => {
      const manager = new PrefilterManager({
        searchFn: mockSearchFn(MOCK_RESULTS),
        scraper: mockScraper(),
        artifactsDir: TEST_DIR,
        enabledEngines: ["tavily"],
      });

      await manager.withParams("test", ["brave"], { name: "fast" });
      const plan = JSON.stringify({
        topic: "test",
        goal: "test",
        researchQuestions: ["q1"],
        engines: ["brave"],
        profile: { name: "fast" },
        scope: { include: "", exclude: "" },
        estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "1" },
      });
      const result = await manager.finalize("test", plan);

      assert.equal(result.phase, "plan_ready");
      assert.equal(result.plan!.engines[0], "duckduckgo");
    });
  });

  describe("doSearching() — runtime safety net", () => {
    it("filters plan engines against plan's frozen allowlist", async () => {
      // Plan carries its own allowlist — state machine respects it
      const { ResearchStateMachine } = await import("../extension/state-machine.js");
      const { ProfileResolver } = await import("../extension/profile-resolver.js");

      const machine = new ResearchStateMachine({
        searchFn: mockSearchFn(MOCK_RESULTS),
        scraper: mockScraper(),
        profileResolver: new ProfileResolver({}),
        artifactsDir: TEST_DIR,
      });

      const snapshot = ResearchStateMachine.init(
        {
          topic: "test",
          goal: "test",
          researchQuestions: ["q1"],
          engines: ["brave", "yandex"], // plan has disallowed engines
          enabledEngines: ["duckduckgo"], // frozen allowlist
          profile: { name: "fast" },
          scope: { include: "", exclude: "" },
          estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "1" },
        },
        new ProfileResolver({}),
      );

      const result = await machine.next(snapshot, {
        topic: "test",
        goal: "test",
        researchQuestions: ["q1"],
        engines: ["brave", "yandex"],
        enabledEngines: ["duckduckgo"],
        profile: { name: "fast" },
        scope: { include: "", exclude: "" },
        estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "1" },
      });

      // Should have advanced to extracting (with duckduckgo as fallback, not brave/yandex)
      assert.equal(result.phase, "extracting");
      assert.ok(result.inject, "must have extraction prompt");
    });
  });
});
