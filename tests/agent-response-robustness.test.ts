import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper } from "../extension/scraper.js";

const PLAN: ResearchPlan = {
  topic: "Test", goal: "Test", researchQuestions: ["Q1", "Q2"],
  engines: ["duckduckgo"], profile: { name: "default" },
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

const RESULTS: WebSearchResult[] = [{ title: "R", url: "https://a.com", snippet: "s", engine: "duckduckgo" }];
function mockSearchFn() { return async () => RESULTS; }
function mockScraper(): Scraper { return { async scrape(url: string) { return { url, title: url, content: "mock" }; } }; }

describe("ResearchStateMachine — agentResponse robustness", () => {
  it("extractQuestions handles string input", async () => {
    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper());
    let s = ResearchStateMachine.init(PLAN);
    s = (await machine.next(s, PLAN)).snapshot;
    s = (await machine.next(s, PLAN)).snapshot; // → questioning
    s = (await machine.next(s, PLAN, "1. Question one?\n2. Question two?")).snapshot;
    assert.equal(s.phase, "extracting"); // didn't crash
  });

  it("extractQuestions handles array input (content blocks)", async () => {
    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper());
    let s = ResearchStateMachine.init(PLAN);
    s = (await machine.next(s, PLAN)).snapshot;
    s = (await machine.next(s, PLAN)).snapshot;
    // AgentMessage.content can be an array of text blocks
    s = (await machine.next(s, PLAN, [{ type: "text", text: "1. Question one?\n2. Question two?" }] as any)).snapshot;
    assert.equal(s.phase, "extracting");
  });

  it("extractQuestions handles undefined agentResponse", async () => {
    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper());
    let s = ResearchStateMachine.init(PLAN);
    s = (await machine.next(s, PLAN)).snapshot;
    s = (await machine.next(s, PLAN)).snapshot;
    s = (await machine.next(s, PLAN, undefined)).snapshot;
    assert.equal(s.phase, "extracting");
  });
});
