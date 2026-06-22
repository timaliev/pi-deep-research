import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchProfile, ResearchSnapshot } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { SearchProvider, SearchResult } from "../extension/search/provider.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "Test",
  goal: "Test goal",
  researchQuestions: ["Q1", "Q2", "Q3", "Q4"],
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

const RESULTS: SearchResult[] = [
  { title: "R1", url: "https://a.com", snippet: "s" },
  { title: "R2", url: "https://b.com", snippet: "s" },
];

function slowSearchProvider(delayMs: number): SearchProvider {
  return {
    async search(_q, _m) {
      await new Promise((r) => setTimeout(r, delayMs));
      return RESULTS;
    },
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
    // With breadth=4, each search takes 50ms.
    // Sequential: 4 × 50 = 200ms. Parallel: ≈ 50ms.
    const profile: ResearchProfile = { breadth: 4, depth: 1, concurrency: 4 };
    const machine = new ResearchStateMachine(
      slowSearchProvider(50),
      slowScraper(5),
      profile
    );

    const snapshot = ResearchStateMachine.init(MOCK_PLAN, profile);
    const start = performance.now();
    const r = await machine.next(snapshot, MOCK_PLAN);
    const elapsed = performance.now() - start;

    // Should have searched all 4 questions
    assert.equal(r.snapshot.searchCalls, 4, "should make 4 search calls");

    // Parallel execution should be under 150ms (with overhead tolerance)
    assert.ok(elapsed < 150, `parallel searches took ${elapsed.toFixed(0)}ms, expected <150ms`);
  });

  it("respects concurrency limit", async () => {
    // concurrency=2, breadth=4, each search 30ms
    // Sequential: 120ms. Parallel with limit 2: ~60ms.
    const profile: ResearchProfile = { breadth: 4, depth: 1, concurrency: 2 };
    const machine = new ResearchStateMachine(
      slowSearchProvider(30),
      slowScraper(5),
      profile
    );

    const snapshot = ResearchStateMachine.init(MOCK_PLAN, profile);
    const start = performance.now();
    const r = await machine.next(snapshot, MOCK_PLAN);
    const elapsed = performance.now() - start;

    assert.equal(r.snapshot.searchCalls, 4);
    // With concurrency=2 and 4 searches at 30ms each: ceil(4/2) × 30 = 60ms
    assert.ok(elapsed < 120, `limited concurrency took ${elapsed.toFixed(0)}ms, expected <120ms`);
  });

  it("completes full cycle with concurrent searches", async () => {
    const profile: ResearchProfile = { breadth: 3, depth: 1, concurrency: 3 };
    const machine = new ResearchStateMachine(
      slowSearchProvider(10),
      slowScraper(5),
      profile
    );

    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    // searching → extracting
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "extracting");
    assert.equal(s.searchCalls, 3, "all 3 breadth searches executed");

    // extracting → drafting (depth=1, no questioning)
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "drafting");

    // drafting → saving → done
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "saving");
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "done");
  });
});
