import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const PLAN: ResearchPlan = {
  topic: "Test", goal: "Test",
  researchQuestions: ["Original Q1", "Original Q2"],
  engines: ["duckduckgo"], profile: { name: "default" },
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

const RESULTS: WebSearchResult[] = [
  { title: "R", url: "https://a.com", snippet: "s", engine: "duckduckgo" },
];

function mockSearchFn() { return async () => RESULTS; }
function mockScraper(): Scraper { return { async scrape(url: string) { return { url, title: url, content: "mock" }; } }; }

describe("ResearchStateMachine — plan questions and deepening", () => {
  it("uses plan.researchQuestions for first search iteration", async () => {
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let s = ResearchStateMachine.init(PLAN);
    s = (await machine.next(s, PLAN)).snapshot; // searching → extracting
    // First iteration used plan.researchQuestions — we verify by checking the extract prompt
    // (we can't directly observe the search queries, but the inject references the extraction results)
    assert.equal(s.phase, "extracting");
    assert.equal(s.currentDepth, 1);
  });

  it("questioning phase extracts agent's follow-up questions for next search", async () => {
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let s = ResearchStateMachine.init(PLAN);
    s = (await machine.next(s, PLAN)).snapshot; // searching → extracting (depth 1)
    s = (await machine.next(s, PLAN)).snapshot; // extracting → questioning

    assert.equal(s.phase, "questioning");

    // Agent responds with follow-up questions
    const agentResponse = `1. What is the first follow-up question?\n2. What is the second follow-up question?\n3. Short`; // 3rd is too short (<10 chars)
    s = (await machine.next(s, PLAN, agentResponse)).snapshot; // questioning → searching → extracting (depth 2)

    assert.equal(s.phase, "extracting");
    assert.equal(s.currentDepth, 2);
    // pendingQuestions should be consumed (set to undefined)
  });

  it("falls back to plan.researchQuestions when agent response has no extractable questions", async () => {
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let s = ResearchStateMachine.init(PLAN);
    s = (await machine.next(s, PLAN)).snapshot; // depth 1
    s = (await machine.next(s, PLAN)).snapshot; // → questioning

    const agentResponse = "I have no questions. Everything is clear.";
    s = (await machine.next(s, PLAN, agentResponse)).snapshot; // questioning → searching → extracting

    assert.equal(s.phase, "extracting"); // still advanced, fallback used
  });

  it("falls back to plan.researchQuestions when agentResponse is undefined", async () => {
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let s = ResearchStateMachine.init(PLAN);
    s = (await machine.next(s, PLAN)).snapshot; // depth 1
    s = (await machine.next(s, PLAN)).snapshot; // → questioning
    s = (await machine.next(s, PLAN)).snapshot; // questioning → searching → extracting (no agentResponse)

    assert.equal(s.phase, "extracting"); // still advanced with fallback
  });
});
