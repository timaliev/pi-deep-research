import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResearchPlan } from "../extension/prefilter.js";
import { ProfileResolver } from "../extension/profile-resolver.js";
import type { ScrapedPage, Scraper } from "../extension/scraper.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import { ResearchStateMachine } from "../extension/state-machine.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "Test",
  goal: "Test",
  researchQuestions: ["Q1", "Q2", "Q3", "Q4"],
  engines: ["duckduckgo"],
  profile: { name: "default" },
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

const ONE_RESULT: WebSearchResult[] = [{ title: "R", url: "https://a.com", snippet: "s", engine: "duckduckgo" }];
function mockSearchFn() {
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
  it("stops deepening when maxSearchCalls reached", async () => {
    const plan: ResearchPlan = { ...MOCK_PLAN, profile: { name: "custom", breadth: 3, depth: 3, concurrency: 3 } };
    const resolver = new ProfileResolver(
      { custom: { breadth: 3, depth: 3, concurrency: 3, maxSearchCalls: 5 } },
      "default",
    );
    const machine = new ResearchStateMachine({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      profileResolver: resolver,
    });
    let s = ResearchStateMachine.init(plan, resolver);
    s = (await machine.next(s, plan)).snapshot;
    assert.equal(s.searchCalls, 3);
    s = (await machine.next(s, plan)).snapshot;
    s = (await machine.next(s, plan)).snapshot;
    assert.equal(s.softLimitTriggered, true);
    s = (await machine.next(s, plan)).snapshot;
    assert.equal(s.phase, "drafting");
    s = (
      await machine.next(
        s,
        plan,
        "# Research Report\n\nThis is a comprehensive research report with detailed analysis.",
      )
    ).snapshot;
    assert.equal(s.phase, "saving");
    s = (await machine.next(s, plan)).snapshot;
    assert.equal(s.phase, "done");
  });

  it("does not trigger when limits are 0", async () => {
    const plan: ResearchPlan = { ...MOCK_PLAN, profile: { name: "custom", breadth: 3, depth: 3, concurrency: 3 } };
    const presets = { custom: { breadth: 3, depth: 3, concurrency: 3 } };
    const resolver = new ProfileResolver(presets, "default");
    const machine = new ResearchStateMachine({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      profileResolver: resolver,
    });
    let s = ResearchStateMachine.init(plan, resolver);
    for (let i = 0; i < 3; i++) s = (await machine.next(s, plan)).snapshot;
    assert.equal(s.softLimitTriggered, false);
  });
});
