import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine, buildTelemetrySection } from "../extension/state-machine.js";
import type { ResearchProfile } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "Test",
  goal: "Test",
  researchQuestions: ["Q1"],
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

function mockSearchFn() {
  return async () => [{ title: "R", url: "https://a.com", snippet: "s", engine: "duckduckgo" }];
}

function mockScraper(): Scraper {
  return {
    async scrape(url: string) {
      return { url, title: url, content: "mock" };
    },
  };
}

describe("Telemetry", () => {
  it("buildTelemetrySection includes all key metrics", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN, { breadth: 2, depth: 2, concurrency: 2 });
    snapshot.searchCalls = 8;
    snapshot.scrapeCalls = 6;
    snapshot.allVisitedUrls = ["https://a.com", "https://b.com", "https://c.com"];
    snapshot.currentDepth = 2;
    snapshot.softLimitTriggered = false;

    const section = buildTelemetrySection(snapshot);

    assert.ok(section.includes("Research Telemetry"), "should have heading");
    assert.ok(section.includes(snapshot.runId), "should include run ID");
    assert.ok(section.includes("8"), "should include search calls");
    assert.ok(section.includes("6"), "should include scrape calls");
    assert.ok(section.includes("3"), "should include visited URLs count");
    assert.ok(section.includes("2/2"), "should include depth");
    assert.ok(section.includes("no"), "should show soft limit not triggered");
  });

  it("shows soft limit as 'yes' when triggered", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN, { breadth: 2, depth: 2, concurrency: 2 });
    snapshot.softLimitTriggered = true;

    const section = buildTelemetrySection(snapshot);
    assert.ok(section.includes("yes"), "should show soft limit triggered");
  });

  it("is valid markdown table format", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN, { breadth: 2, depth: 2, concurrency: 2 });

    const section = buildTelemetrySection(snapshot);
    const lines = section.split("\n");

    // Check table structure
    assert.ok(lines.some((l) => l.startsWith("| Metric | Value |")), "should have header row");
    assert.ok(lines.some((l) => l.startsWith("| --- |")), "should have separator row");
    assert.ok(lines.every((l) => !l.includes("undefined")), "no undefined values");
  });

  it("formats duration in seconds and minutes", async () => {
    // Create snapshot with startedAt long ago
    const snapshot = ResearchStateMachine.init(MOCK_PLAN, { breadth: 1, depth: 1, concurrency: 1 });
    snapshot.startedAt = Date.now() - 125 * 1000; // 125 seconds ago

    const section = buildTelemetrySection(snapshot);
    assert.ok(section.includes("2m"), "should show minutes for >60s duration");
  });
});
