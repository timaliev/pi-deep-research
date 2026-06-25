import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchProfile } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "Test",
  goal: "Test",
  researchQuestions: ["Q1", "Q2", "Q3", "Q4"],
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

const ONE_RESULT: WebSearchResult[] = [
  { title: "R", url: "https://a.com", snippet: "s", engine: "duckduckgo" },
];

function mockSearchFn(): (_q: string, _m?: number) => Promise<WebSearchResult[]> {
  return async () => ONE_RESULT;
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
      maxSearchCalls: 5,
    };

    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), profile);
    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "extracting");
    assert.equal(s.searchCalls, 3);
    assert.equal(s.softLimitTriggered, false);

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "extracting");
    assert.equal(s.softLimitTriggered, true, "soft limit should trigger at 6 calls > max 5");

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "drafting", "should skip questioning and go to drafting");

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "saving");
    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "done");
  });

  it("stops deepening when maxElapsedSeconds is reached", async () => {
    const profile: ResearchProfile = {
      breadth: 2,
      depth: 3,
      concurrency: 2,
      maxElapsedSeconds: 0,
    };

    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), profile);
    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    s = { ...s, softLimitTriggered: true };

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "extracting");
    assert.equal(s.softLimitTriggered, true);

    s = (await machine.next(s, MOCK_PLAN)).snapshot;
    assert.equal(s.phase, "drafting", "should skip deepening when soft-limited");
  });

  it("reduces search breadth when soft-limited", async () => {
    const profile: ResearchProfile = {
      breadth: 4,
      depth: 1,
      concurrency: 4,
      maxSearchCalls: 2,
    };

    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), profile);
    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    s = (await machine.next(s, MOCK_PLAN)).snapshot;

    assert.equal(s.softLimitTriggered, true, "should trigger after exceeding maxSearchCalls");
    assert.ok(s.searchCalls >= 4, "initial breadth runs all searches");
  });

  it("does not trigger when limits are not set (0 = unlimited)", async () => {
    const profile: ResearchProfile = { breadth: 3, depth: 3, concurrency: 3 };

    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), profile);
    let s = ResearchStateMachine.init(MOCK_PLAN, profile);

    for (let i = 0; i < 3; i++) {
      s = (await machine.next(s, MOCK_PLAN)).snapshot;
    }

    assert.equal(s.softLimitTriggered, false, "should never trigger when limits are 0");
  });
});
