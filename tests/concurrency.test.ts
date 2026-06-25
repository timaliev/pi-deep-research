import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchProfile } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "Test",
  goal: "Test goal",
  researchQuestions: ["Q1", "Q2", "Q3", "Q4"],
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

const RESULTS: WebSearchResult[] = [
  { title: "R1", url: "https://a.com", snippet: "s", engine: "duckduckgo" },
  { title: "R2", url: "https://b.com", snippet: "s", engine: "duckduckgo" },
];

function slowSearchFn(delayMs: number) {
  return async (_q: string, _m?: number) => {
    await new Promise((r) => setTimeout(r, delayMs));
    return RESULTS;
  };
}

function slowScraper(delayMs: number): Scraper {
  return {
    async scrape(url: string) {
      await new Promise((r) => setTimeout(r, delayMs));
      return { url, title: url, content: "mock" };
    },
  };
}

describe("ResearchStateMachine concurrency", () => {
  it("completes parallel searches faster than sequential", async () => {
    const profile: ResearchProfile = { breadth: 4, depth: 1, concurrency: 4 };
    const machine = new ResearchStateMachine(
      slowSearchFn(50),
      slowScraper(5),
      profile
    );

    const snapshot = ResearchStateMachine.init(MOCK_PLAN, profile);
    const start = performance.now();
    const r = await machine.next(snapshot, MOCK_PLAN);
    const elapsed = performance.now() - start;

    assert.equal(r.snapshot.searchCalls, 4, "should make 4 search calls");
    assert.ok(elapsed < 150, `parallel searches took ${elapsed.toFixed(0)}ms, expected <150ms`);
  });

  it("respects concurrency limit", async () => {
    const profile: ResearchProfile = { breadth: 4, depth: 1, concurrency: 2 };
    const machine = new ResearchStateMachine(
      slowSearchFn(30),
      slowScraper(5),
      profile
    );

    const snapshot = ResearchStateMachine.init(MOCK_PLAN, profile);
    const start = performance.now();
    const r = await machine.next(snapshot, MOCK_PLAN);
    const elapsed = performance.now() - start;

    assert.equal(r.snapshot.searchCalls, 4);
    assert.ok(elapsed < 120, `limited concurrency took ${elapsed.toFixed(0)}ms, expected <120ms`);
  });

  it("completes full cycle with concurrent searches", async () => {
    const profile: ResearchProfile = { breadth: 3, depth: 1, concurrency: 3 };
    const machine = new ResearchStateMachine(
      slowSearchFn(10),
      slowScraper(5),
      profile
    );

    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "extracting");
    assert.equal(s.searchCalls, 3, "all 3 breadth searches executed");

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "drafting");

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "saving");
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "done");
  });
});
