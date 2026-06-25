import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "Test", goal: "Test", researchQuestions: ["Q1", "Q2", "Q3", "Q4"],
  engines: ["duckduckgo"], profile: { name: "default" },
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

const RESULTS: WebSearchResult[] = [
  { title: "R1", url: "https://a.com", snippet: "s", engine: "duckduckgo" },
  { title: "R2", url: "https://b.com", snippet: "s", engine: "duckduckgo" },
];

function slowSearchFn(delayMs: number) {
  return async () => { await new Promise(r => setTimeout(r, delayMs)); return RESULTS; };
}

function slowScraper(delayMs: number): Scraper {
  return { async scrape(url: string) { await new Promise(r => setTimeout(r, delayMs)); return { url, title: url, content: "mock" }; } };
}

describe("ResearchStateMachine concurrency", () => {
  it("completes parallel searches faster than sequential", async () => {
    const plan: ResearchPlan = { ...MOCK_PLAN, profile: { name: "custom", breadth: 4, depth: 1, concurrency: 4 } };
    const machine = new ResearchStateMachine(slowSearchFn(50), slowScraper(5));
    const snapshot = ResearchStateMachine.init(plan);
    const start = performance.now();
    const r = await machine.next(snapshot, plan);
    assert.equal(r.snapshot.searchCalls, 4);
    assert.ok(performance.now() - start < 150);
  });

  it("completes full cycle with concurrent searches", async () => {
    const plan: ResearchPlan = { ...MOCK_PLAN, profile: { name: "custom", breadth: 3, depth: 1, concurrency: 3 } };
    const machine = new ResearchStateMachine(slowSearchFn(10), slowScraper(5));
    let s = ResearchStateMachine.init(plan);
    s = (await machine.next(s, plan)).snapshot; assert.equal(s.phase, "extracting");
    s = (await machine.next(s, plan)).snapshot; assert.equal(s.phase, "drafting");
    s = (await machine.next(s, plan, "# Research Report\n\nThis is a comprehensive research report with detailed analysis and findings from multiple sources.")).snapshot; assert.equal(s.phase, "saving");
    s = (await machine.next(s, plan)).snapshot; assert.equal(s.phase, "done");
  });
});
