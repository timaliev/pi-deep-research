import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrefilterManager } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const TEST_ARTIFACTS = join(import.meta.dirname ?? ".", "..", "test-artifacts");

function mockSearchFn(results: WebSearchResult[]) {
  return async (_query: string, _max?: number) => results;
}

function mockScraper(pages: Map<string, ScrapedPage>): Scraper {
  return {
    async scrape(url: string) {
      const page = pages.get(url);
      if (!page) throw new Error(`No mock page for ${url}`);
      return page;
    },
  };
}

const MOCK_RESULTS: WebSearchResult[] = [
  { title: "XState Docs", url: "https://xstate.js.org/docs/", snippet: "State machines.", engine: "duckduckgo" },
  { title: "Refactoring.Guru", url: "https://refactoring.guru/", snippet: "Design patterns.", engine: "duckduckgo" },
];

function mockScrapedPages(): Map<string, ScrapedPage> {
  const m = new Map<string, ScrapedPage>();
  m.set("https://xstate.js.org/docs/", { url: "https://xstate.js.org/docs/", title: "XState Docs", content: "State machines and statecharts." });
  m.set("https://refactoring.guru/", { url: "https://refactoring.guru/", title: "Refactoring", content: "The State pattern." });
  return m;
}

const VALID_PLAN = JSON.stringify({
  topic: "State machine patterns",
  goal: "Compare libraries",
  researchQuestions: ["Q1", "Q2", "Q3"],
  engines: ["duckduckgo"],
  profile: { name: "default" },
  scope: { include: "TS libs", exclude: "Non-TS" },
  estimatedCost: { searchCalls: 12, scrapeCalls: 8, description: "~12 searches" },
});

describe("PrefilterManager", () => {
  beforeEach(() => { mkdirSync(TEST_ARTIFACTS, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_ARTIFACTS)) rmSync(TEST_ARTIFACTS, { recursive: true, force: true }); });

  describe("start", () => {
    it("returns awaiting_params with engines+profile prompt", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      const result = await manager.start("state machines");

      assert.equal(result.phase, "awaiting_params");
      assert.ok(result.inject, "must have inject prompt");
      assert.ok(result.inject!.includes("engines"), "must mention engines");
      assert.ok(result.inject!.includes("profile"), "must mention profile");
    });
  });

  describe("withParams", () => {
    it("returns search results and plan inject for awaiting_plan", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      await manager.start("state machines");

      const result = await manager.withParams("state machines", ["duckduckgo"], { name: "default" });

      assert.equal(result.phase, "awaiting_plan");
      assert.ok(result.inject, "must have inject");
      assert.ok(result.inject!.includes("XState"), "inject must reference search results");
      assert.equal(result.searchResults!.length, 2);
      assert.equal(result.scrapedContent!.length, 2);
    });

    it("requires JSON output in plan prompt", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      const result = await manager.withParams("test", ["duckduckgo"], { name: "default" });
      assert.ok(result.inject!.includes("JSON"), "inject must ask for JSON");
    });
  });

  describe("finalize", () => {
    it("saves valid plan as artifact", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      await manager.start("state machines");

      const result = await manager.finalize("state machines", VALID_PLAN);

      assert.equal(result.phase, "plan_ready");
      assert.ok(result.planArtifactPath!.endsWith(".json"));
      assert.ok(existsSync(result.planArtifactPath!));

      const artifact = JSON.parse(readFileSync(result.planArtifactPath!, "utf-8"));
      assert.equal(artifact.plan.topic, "State machine patterns");
      assert.equal(artifact.plan.researchQuestions.length, 3);
      assert.deepEqual(artifact.plan.engines, ["duckduckgo"]);
      assert.equal(artifact.plan.profile.name, "default");
    });

    it("rejects invalid JSON", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      await manager.start("test");
      const result = await manager.finalize("test", "not valid json {{{");
      assert.equal(result.phase, "error");
    });

    it("rejects JSON missing required fields", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      await manager.start("test");
      const result = await manager.finalize("test", JSON.stringify({
        topic: "test", researchQuestions: [], scope: { include: "", exclude: "" },
        estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
      }));
      assert.equal(result.phase, "error");
    });

    it("rejects plan with empty research questions", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      await manager.start("test");
      const result = await manager.finalize("test", JSON.stringify({
        topic: "test", goal: "goal", researchQuestions: [], engines: ["duckduckgo"],
        profile: { name: "default" }, scope: { include: "a", exclude: "b" },
        estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
      }));
      assert.equal(result.phase, "error");
    });

    it("uses shared runId across all three steps when set via constructor", async () => {
      const sharedRunId = "shared-run-001";
      const manager = new PrefilterManager(
        mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS,
        undefined, undefined, undefined, sharedRunId
      );

      const r1 = await manager.start("state machines");
      assert.equal(r1.runId, sharedRunId, "start must use shared runId");

      const r2 = await manager.withParams("state machines", ["duckduckgo"], { name: "default" });
      assert.equal(r2.runId, sharedRunId, "withParams must use shared runId");

      const r3 = await manager.finalize("state machines", VALID_PLAN);
      assert.equal(r3.runId, sharedRunId, "finalize must use shared runId");

      const artifact = JSON.parse(readFileSync(r3.planArtifactPath!, "utf-8"));
      assert.equal(artifact.runId, sharedRunId, "artifact must store shared runId");
    });

    it("generates its own runId when no shared runId provided", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      const r1 = await manager.start("test");
      assert.match(r1.runId, /^\d{8}-\d{6}$/, "must generate valid runId");
    });

    it("stores actual search result count and scraped URLs in artifact", async () => {
      const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
      await manager.start("state machines");
      const paramsResult = await manager.withParams("state machines", ["duckduckgo"], { name: "default" });
      const finalResult = await manager.finalize("state machines", VALID_PLAN);

      const artifact = JSON.parse(readFileSync(finalResult.planArtifactPath!, "utf-8"));
      assert.equal(artifact.preliminarySearch.resultsCount, paramsResult.searchResults!.length,
        "resultsCount must match actual search result count");
      assert.equal(artifact.preliminarySearch.scrapedUrls.length, 2,
        "scrapedUrls must contain scraped URLs");
      assert.ok(artifact.preliminarySearch.scrapedUrls.includes("https://xstate.js.org/docs/"),
        "scrapedUrls must include xstate URL");
    });
  });
});
