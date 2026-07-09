import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PrefilterManager } from "../extension/prefilter.js";
import type { ScrapedPage, Scraper } from "../extension/scraper.js";
import type { WebSearchResult } from "../extension/search/web-search.js";

const TEST_ARTIFACTS = join(import.meta.dirname ?? ".", "..", "test-artifacts-params");

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
  {
    title: "XState Docs",
    url: "https://xstate.js.org/docs/",
    snippet: "State machines for JS/TS.",
    engine: "duckduckgo",
  },
  { title: "Refactoring.Guru", url: "https://refactoring.guru/", snippet: "Design patterns.", engine: "duckduckgo" },
];

function mockScrapedPages(): Map<string, ScrapedPage> {
  const m = new Map<string, ScrapedPage>();
  m.set("https://xstate.js.org/docs/", {
    url: "https://xstate.js.org/docs/",
    title: "XState",
    content: "State machines...",
  });
  m.set("https://refactoring.guru/", {
    url: "https://refactoring.guru/",
    title: "Refactoring",
    content: "Design patterns...",
  });
  return m;
}

describe("PrefilterManager — plan-driven params", () => {
  beforeEach(() => {
    mkdirSync(TEST_ARTIFACTS, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(TEST_ARTIFACTS)) rmSync(TEST_ARTIFACTS, { recursive: true, force: true });
  });

  it("start() returns awaiting_params with params inject prompt", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
    const result = await manager.start("test topic");

    assert.equal(result.phase, "awaiting_params");
    assert.ok(result.inject, "must have inject prompt");
    assert.ok(result.inject!.includes("engines"), "inject must mention engines");
    assert.ok(result.inject!.includes("profile"), "inject must mention profile");
  });

  it("withParams() runs preliminary search and returns awaiting_plan", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
    const result = await manager.withParams("test topic", ["duckduckgo"], { name: "default" });

    assert.equal(result.phase, "awaiting_plan");
    assert.ok(result.searchResults, "must have search results");
    assert.ok(result.searchResults!.length > 0);
    assert.ok(result.inject!.includes("Research Planning"), "inject must ask for plan");
  });

  it("withParams() inject shows resolved profile params and that profile can be changed", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    // Test with named profile
    const r1 = await manager.withParams("test", ["duckduckgo"], { name: "deep" });
    assert.ok(r1.inject!.includes("Profile"), "must mention Profile");
    assert.ok(r1.inject!.includes("deep"), "must include profile name");
    assert.ok(r1.inject!.includes("breadth"), "must show breadth");
    assert.ok(r1.inject!.includes("depth"), "must show depth");
    assert.ok(r1.inject!.includes("concurrency"), "must show concurrency");
    assert.ok(
      r1.inject!.includes("change") || r1.inject!.includes("override") || r1.inject!.includes("adjust"),
      "must indicate profile can be changed",
    );

    // Test with custom profile
    const r2 = await manager.withParams("test", ["duckduckgo"], { name: "custom", breadth: 8, depth: 3 });
    assert.ok(r2.inject!.includes("custom"), "must include custom profile name");
    assert.ok(r2.inject!.includes("breadth"), "custom profile must show breadth");
  });

  it("withParams() returns awaiting_params when brave selected but no API key", async () => {
    // Ensure BRAVE_API_KEY is unset for this test
    const oldKey = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;

    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
    const result = await manager.withParams("test", ["brave", "duckduckgo"], { name: "fast" });

    // Restore
    if (oldKey) process.env.BRAVE_API_KEY = oldKey;

    assert.equal(result.phase, "awaiting_params");
    assert.ok(result.inject!.includes("BRAVE_API_KEY"), "must warn about missing key");
  });

  it("finalize() validates engines and profile in plan JSON", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    // Missing engines
    const badPlan = JSON.stringify({
      topic: "test",
      goal: "test",
      researchQuestions: ["q"],
      scope: { include: "a", exclude: "b" },
      profile: { name: "default" },
      estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
    });

    const result = await manager.finalize("test", badPlan);
    assert.equal(result.phase, "error");
    assert.ok(result.error!.includes("engines"), "must reject plan missing engines array");
  });

  it("finalize() validates profile.name must be valid", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    const badPlan = JSON.stringify({
      topic: "test",
      goal: "test",
      researchQuestions: ["q"],
      engines: ["duckduckgo"],
      scope: { include: "a", exclude: "b" },
      profile: { name: "invalid" },
      estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
    });

    const result = await manager.finalize("test", badPlan);
    assert.equal(result.phase, "error");
    assert.ok(result.error!.includes("profile"), "must reject invalid profile name");
  });

  it("finalize() validates custom profile has breadth and depth", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    const badPlan = JSON.stringify({
      topic: "test",
      goal: "test",
      researchQuestions: ["q"],
      engines: ["duckduckgo"],
      scope: { include: "a", exclude: "b" },
      profile: { name: "custom" },
      estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
    });

    const result = await manager.finalize("test", badPlan);
    assert.equal(result.phase, "error");
    assert.ok(result.error!.includes("breadth"), "custom must include breadth");
  });

  it("finalize() accepts valid plan with engines + profile", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    await manager.start("test");

    const validPlan = JSON.stringify({
      topic: "test",
      goal: "test goal",
      researchQuestions: ["q1", "q2", "q3"],
      engines: ["duckduckgo"],
      scope: { include: "a", exclude: "b" },
      profile: { name: "deep" },
      estimatedCost: { searchCalls: 12, scrapeCalls: 8, description: "~12 searches" },
    });

    const result = await manager.finalize("test", validPlan);
    assert.equal(result.phase, "plan_ready");
    assert.ok(result.planArtifactPath);
    assert.ok(existsSync(result.planArtifactPath!));
  });
});
