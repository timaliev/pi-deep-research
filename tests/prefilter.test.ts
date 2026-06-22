import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrefilterManager } from "../extension/prefilter.js";
import type { SearchProvider, SearchResult } from "../extension/search/provider.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const TEST_ARTIFACTS = join(import.meta.dirname ?? ".", "../test-artifacts");

function mockSearchProvider(results: SearchResult[]): SearchProvider {
  return {
    async search(_query: string, _max?: number) {
      return results;
    },
  };
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

const MOCK_RESULTS: SearchResult[] = [
  {
    title: "XState - JavaScript State Machines",
    url: "https://xstate.js.org/docs/",
    snippet: "XState is a state management library for JavaScript and TypeScript.",
  },
  {
    title: "State Pattern in TypeScript - Refactoring.Guru",
    url: "https://refactoring.guru/design-patterns/state/typescript",
    snippet: "State is a behavioral design pattern.",
  },
];

function mockScrapedPages(): Map<string, ScrapedPage> {
  const map = new Map<string, ScrapedPage>();
  map.set("https://xstate.js.org/docs/", {
    url: "https://xstate.js.org/docs/",
    title: "XState Docs",
    content: "XState uses state machines and statecharts to manage application state. It supports hierarchical states, parallel states, and guards.",
  });
  map.set("https://refactoring.guru/design-patterns/state/typescript", {
    url: "https://refactoring.guru/design-patterns/state/typescript",
    title: "State Pattern in TypeScript",
    content: "The State pattern allows an object to change its behavior when its internal state changes. It appears as if the object changed its class.",
  });
  return map;
}

describe("PrefilterManager", () => {
  beforeEach(() => {
    if (!existsSync(TEST_ARTIFACTS)) {
      mkdirSync(TEST_ARTIFACTS, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_ARTIFACTS)) {
      rmSync(TEST_ARTIFACTS, { recursive: true, force: true });
    }
  });

  describe("start", () => {
    it("returns search results and inject prompt for first call", async () => {
      const manager = new PrefilterManager(
        mockSearchProvider(MOCK_RESULTS),
        mockScraper(mockScrapedPages()),
        TEST_ARTIFACTS
      );

      const result = await manager.start("state machine patterns in typescript");

      assert.equal(result.phase, "awaiting_plan");
      assert.ok(result.runId, "should generate a runId");
      assert.ok(result.inject, "should include an inject prompt for the agent");
      assert.ok(
        result.inject!.includes("state machine"),
        "inject should reference the topic"
      );
      assert.equal(result.searchResults!.length, 2, "should return search results");
      assert.equal(
        result.scrapedContent!.length,
        2,
        "should return scraped content"
      );
    });

    it("includes scraped content in the inject prompt", async () => {
      const manager = new PrefilterManager(
        mockSearchProvider(MOCK_RESULTS),
        mockScraper(mockScrapedPages()),
        TEST_ARTIFACTS
      );

      const result = await manager.start("state machines");

      assert.ok(
        result.inject!.includes("XState"),
        "inject should reference scraped content"
      );
      assert.ok(
        result.inject!.includes("Refactoring.Guru"),
        "inject should reference second scraped page"
      );
    });

    it("requires JSON output instruction in inject", async () => {
      const manager = new PrefilterManager(
        mockSearchProvider(MOCK_RESULTS),
        mockScraper(mockScrapedPages()),
        TEST_ARTIFACTS
      );

      const result = await manager.start("state machines");
      assert.ok(
        result.inject!.includes("JSON"),
        "inject must ask for JSON output"
      );
    });
  });

  describe("finalize", () => {
    it("saves valid JSON plan as artifact", async () => {
      const manager = new PrefilterManager(
        mockSearchProvider(MOCK_RESULTS),
        mockScraper(mockScrapedPages()),
        TEST_ARTIFACTS
      );

      // First call: start
      const startResult = await manager.start("state machines");

      // Second call: finalize with agent's plan
      const planJson = JSON.stringify({
        topic: "State machine patterns in TypeScript",
        goal: "Compare state machine libraries and patterns for TypeScript applications",
        researchQuestions: [
          "What are the most popular TypeScript state machine libraries?",
          "How does XState compare to simple reducer patterns?",
          "What are the performance characteristics of state machines in TypeScript?",
        ],
        scope: {
          include: "TypeScript state machine libraries, design patterns, performance",
          exclude: "Non-TypeScript implementations, general CS theory",
        },
        estimatedCost: {
          searchCalls: 12,
          scrapeCalls: 8,
          description: "~12 DDG searches, 8 page scrapes",
        },
      });

      const result = await manager.finalize("state machines", planJson);

      assert.equal(result.phase, "plan_ready");
      assert.ok(
        result.planArtifactPath!.endsWith(".json"),
        "should produce a JSON artifact path"
      );
      assert.ok(existsSync(result.planArtifactPath!), "artifact file must exist");

      // Verify artifact content
      const artifactJson = readFileSync(result.planArtifactPath!, "utf-8");
      const artifact = JSON.parse(artifactJson);
      assert.equal(artifact.version, 1);
      assert.equal(artifact.plan.topic, "State machine patterns in TypeScript");
      assert.equal(artifact.plan.researchQuestions.length, 3);
    });

    it("rejects invalid JSON", async () => {
      const manager = new PrefilterManager(
        mockSearchProvider(MOCK_RESULTS),
        mockScraper(mockScrapedPages()),
        TEST_ARTIFACTS
      );

      await manager.start("state machines");

      const result = await manager.finalize("state machines", "not valid json {{{");

      assert.equal(result.phase, "error");
      assert.ok(result.error, "should have an error message");
    });

    it("rejects JSON missing required fields", async () => {
      const manager = new PrefilterManager(
        mockSearchProvider(MOCK_RESULTS),
        mockScraper(mockScrapedPages()),
        TEST_ARTIFACTS
      );

      await manager.start("state machines");

      // Missing 'goal' field
      const incompleteJson = JSON.stringify({
        topic: "test",
        researchQuestions: [],
        scope: { include: "", exclude: "" },
        estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
      });

      const result = await manager.finalize("state machines", incompleteJson);
      assert.equal(result.phase, "error");
      assert.ok(result.error!.includes("goal"), "should mention missing field 'goal'");
    });

    it("rejects plan with empty research questions", async () => {
      const manager = new PrefilterManager(
        mockSearchProvider(MOCK_RESULTS),
        mockScraper(mockScrapedPages()),
        TEST_ARTIFACTS
      );

      await manager.start("state machines");

      const emptyQuestions = JSON.stringify({
        topic: "test",
        goal: "test goal",
        researchQuestions: [],
        scope: { include: "a", exclude: "b" },
        estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
      });

      const result = await manager.finalize("state machines", emptyQuestions);
      assert.equal(result.phase, "error");
      assert.ok(
        result.error!.includes("research"),
        "should mention research questions"
      );
    });
  });
});
