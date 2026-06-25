import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchProfile } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "State machines in TypeScript",
  goal: "Compare state machine libraries for TypeScript applications",
  researchQuestions: [
    "What are popular TypeScript state machine libraries?",
    "How does XState compare to simple reducer patterns?",
  ],
  scope: { include: "Libraries, patterns, performance", exclude: "Non-TS implementations" },
  estimatedCost: { searchCalls: 8, scrapeCalls: 4, description: "~8 searches, 4 scrapes" },
};

const MOCK_PROFILE: ResearchProfile = { breadth: 2, depth: 2, concurrency: 1 };

const MOCK_RESULTS: WebSearchResult[] = [
  { title: "XState Docs", url: "https://xstate.js.org", snippet: "XState is a state machine library for JS/TS.", engine: "duckduckgo" },
  { title: "Robot FSM", url: "https://thisrobot.life", snippet: "Robot is a lightweight finite state machine library.", engine: "duckduckgo" },
];

function mockScrapedPages(): Map<string, ScrapedPage> {
  const map = new Map<string, ScrapedPage>();
  map.set("https://xstate.js.org", {
    url: "https://xstate.js.org",
    title: "XState Docs",
    content: "XState: State machines and statecharts for the modern web.",
  });
  map.set("https://thisrobot.life", {
    url: "https://thisrobot.life",
    title: "Robot FSM",
    content: "Robot is a lightweight finite state machine library.",
  });
  return map;
}

function mockSearchFn(results: WebSearchResult[] = MOCK_RESULTS) {
  return async (_q: string, _m?: number) => results;
}

function mockScraper(): Scraper {
  const pages = mockScrapedPages();
  return {
    async scrape(url: string) {
      const page = pages.get(url);
      if (!page) throw new Error(`No mock for ${url}`);
      return page;
    },
  };
}

describe("ResearchStateMachine", () => {
  it("completes full cycle for depth=2: s→e→q→(s+e)→d→saving→done", async () => {
    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), MOCK_PROFILE);
    let s = ResearchStateMachine.init(MOCK_PLAN, MOCK_PROFILE);

    // Call 1: searching → extracting (depth 0→1, inject: extraction)
    assert.equal(s.phase, "searching");
    let r = await machine.next(s, MOCK_PLAN);
    assert.equal(r.phase, "extracting");
    assert.ok(r.inject!.includes("Extraction"), "extraction inject");
    s = r.snapshot;
    assert.equal(s.currentDepth, 1);

    // Call 2: extracting → questioning (inject: deepening)
    assert.equal(s.phase, "extracting");
    r = await machine.next(s, MOCK_PLAN);
    assert.equal(r.phase, "questioning");
    assert.ok(r.inject!.includes("Deepening"), "questioning inject");
    s = r.snapshot;

    // Call 3: questioning → searching → extracting (chains, inject: extraction, depth=2)
    assert.equal(s.phase, "questioning");
    r = await machine.next(s, MOCK_PLAN);
    assert.equal(r.phase, "extracting", "questioning chains through searching to extracting");
    assert.ok(r.inject!.includes("Extraction"), "extraction inject after chained search");
    s = r.snapshot;
    assert.equal(s.currentDepth, 2, "depth advanced to 2");

    // Call 4: extracting → drafting (depth=total, inject: drafting)
    assert.equal(s.phase, "extracting");
    r = await machine.next(s, MOCK_PLAN);
    assert.equal(r.phase, "drafting");
    assert.ok(r.inject!.includes("Final Report"), "drafting inject");
    s = r.snapshot;

    // Call 5: drafting → saving (no inject, agent's draft is saved)
    assert.equal(s.phase, "drafting");
    r = await machine.next(s, MOCK_PLAN);
    assert.equal(r.phase, "saving");
    s = r.snapshot;

    // Call 6: saving → done
    assert.equal(s.phase, "saving");
    r = await machine.next(s, MOCK_PLAN);
    assert.equal(r.phase, "done");

    // Call 7: done → done (idempotent)
    r = await machine.next(r.snapshot, MOCK_PLAN);
    assert.equal(r.phase, "done");
  });

  it("accumulates search and scrape counts across depth iterations", async () => {
    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), MOCK_PROFILE);
    let s = ResearchStateMachine.init(MOCK_PLAN, MOCK_PROFILE);

    // Searching phase (breadth=2)
    let r = await machine.next(s, MOCK_PLAN);
    const afterFirstSearch = r.snapshot.searchCalls;
    assert.ok(afterFirstSearch >= 2, "first search phase calls");

    // Advance: extracting → questioning → (searching+extracting)
    r = await machine.next(r.snapshot, MOCK_PLAN); // extracting → questioning
    r = await machine.next(r.snapshot, MOCK_PLAN); // questioning → searching→extracting
    assert.ok(r.snapshot.searchCalls > afterFirstSearch, "search calls accumulate");
  });

  it("generates inject prompts at each phase that needs agent reasoning", async () => {
    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), MOCK_PROFILE);
    const s = ResearchStateMachine.init(MOCK_PLAN, MOCK_PROFILE);

    let r = await machine.next(s, MOCK_PLAN);
    assert.ok(r.inject!.includes("Extraction"), "phase 1: extraction");

    r = await machine.next(r.snapshot, MOCK_PLAN);
    assert.ok(r.inject!.includes("Deepening"), "phase 2: questioning");

    r = await machine.next(r.snapshot, MOCK_PLAN);
    assert.ok(r.inject!.includes("Extraction"), "phase 3: extraction (depth 2)");

    r = await machine.next(r.snapshot, MOCK_PLAN);
    assert.ok(r.inject!.includes("Final Report"), "phase 4: drafting");
  });

  it("stays in done phase on repeated calls", async () => {
    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), { ...MOCK_PROFILE, depth: 1 });
    let s = ResearchStateMachine.init(MOCK_PLAN, { ...MOCK_PROFILE, depth: 1 });

    s = (await machine.next(s, MOCK_PLAN)).snapshot; // searching → extracting
    s = (await machine.next(s, MOCK_PLAN)).snapshot; // extracting → drafting
    s = (await machine.next(s, MOCK_PLAN)).snapshot; // drafting → saving
    s = (await machine.next(s, MOCK_PLAN)).snapshot; // saving → done
    assert.equal(s.phase, "done");

    const r = await machine.next(s, MOCK_PLAN);
    assert.equal(r.phase, "done");
  });

  it("skips questioning when depth reaches total depth", async () => {
    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), { breadth: 2, depth: 1, concurrency: 1 });
    let s = ResearchStateMachine.init(MOCK_PLAN, { breadth: 2, depth: 1, concurrency: 1 });

    s = (await machine.next(s, MOCK_PLAN)).snapshot; // searching → extracting (depth=1)
    assert.equal(s.phase, "extracting");
    assert.equal(s.currentDepth, 1);

    const r = await machine.next(s, MOCK_PLAN); // extracting → drafting (not questioning)
    assert.equal(r.phase, "drafting", "should skip questioning at max depth");
  });
});
