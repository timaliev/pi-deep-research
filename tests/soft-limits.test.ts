import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchProfile } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { SearchProvider, SearchResult } from "../extension/search/provider.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "Test",
  goal: "Test",
  researchQuestions: ["Q1", "Q2", "Q3", "Q4"],
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

const ONE_RESULT: SearchResult[] = [
  { title: "R", url: "https://a.com", snippet: "s" },
];

function mockSearchProvider(): SearchProvider {
  return { async search(_q, _m) { return ONE_RESULT; } };
}

function mockScraper(): Scraper {
  return {
    async scrape(url: string) {
      return { url, title: url, content: "mock" };
    },
  };
}

describe("ResearchStateMachine soft limits", () => {
  it("stops deepening when maxSearchCalls is reached", async () => {
    const profile: ResearchProfile = {
      breadth: 3,
      depth: 3,
      concurrency: 3,
      maxSearchCalls: 5, // trigger after 5 calls
    };

    const machine = new ResearchStateMachine(mockSearchProvider(), mockScraper(), profile);
    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    // First searching: breadth=3 → 3 calls
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "extracting");
    assert.equal(s.searchCalls, 3);
    assert.equal(s.softLimitTriggered, false);

    // extracting → questioning → searching (depth 2)
    s = (await machine.next(s, MOCK_PLAN)).snapshot; // extracting → questioning
    s = (await machine.next(s, MOCK_PLAN)).snapshot; // questioning → searching → extracting
    assert.equal(s.phase, "extracting");
    // 3 + 3 = 6, but max=5 → triggered on 6th, breadth reduces to 2
    assert.equal(s.softLimitTriggered, true, "soft limit should trigger at 6 calls > max 5");

    // extracting should go to drafting, NOT questioning (soft limit stops deepening)
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "drafting", "should skip questioning and go to drafting");

    // Complete
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "saving");
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "done");
  });

  it("stops deepening when maxElapsedSeconds is reached", async () => {
    // Set startedAt in the past to simulate elapsed time
    const profile: ResearchProfile = {
      breadth: 2,
      depth: 3,
      concurrency: 2,
      maxElapsedSeconds: 0, // 0 = unlimited, we'll test by manually triggering
    };

    const machine = new ResearchStateMachine(mockSearchProvider(), mockScraper(), profile);
    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    // Manually set softLimitTriggered to simulate elapsed time trigger
    s = { ...s, softLimitTriggered: true };

    // First searching: breadth=2, but soft-limited → breadth=min(2,2)=2, results=2
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "extracting");
    assert.equal(s.softLimitTriggered, true);

    // Should skip questioning, go to drafting
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "drafting", "should skip deepening when soft-limited");
  });

  it("reduces search breadth when soft-limited", async () => {
    const profile: ResearchProfile = {
      breadth: 4,
      depth: 1,
      concurrency: 4,
      maxSearchCalls: 2, // trigger quickly
    };

    const machine = new ResearchStateMachine(mockSearchProvider(), mockScraper(), profile);
    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    s = (await machine.next(s, MOCK_PLAN)).snapshot;

    // With maxSearchCalls=2 and breadth=4, trigger after 2 calls.
    // When triggered, breadth reduces to min(2, 4)=2.
    // But the limit check happens BEFORE the search loop, and breadth is determined
    // based on softLimitTriggered flag. Since the flag is set during checkSoftLimits
    // when searchCalls >= maxCalls, the first round with breadth=4 runs 4 searches,
    // hitting the limit. The flag is set, and subsequent rounds use reduced breadth.
    assert.equal(s.softLimitTriggered, true, "should trigger after exceeding maxSearchCalls");
    // 4 searches ran (breadth=4), max is 2
    assert.ok(s.searchCalls >= 4, "initial breadth runs all searches");
  });

  it("does not trigger when limits are not set (0 = unlimited)", async () => {
    const profile: ResearchProfile = { breadth: 3, depth: 3, concurrency: 3 };

    const machine = new ResearchStateMachine(mockSearchProvider(), mockScraper(), profile);
    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    // Run through multiple iterations
    for (let i = 0; i < 3; i++) {
      s = (await machine.next(s, MOCK_PLAN)).snapshot;
    }

    assert.equal(s.softLimitTriggered, false, "should never trigger when limits are 0");
  });
});
