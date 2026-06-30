import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "State machines in TypeScript",
  goal: "Compare state machine libraries",
  researchQuestions: ["Q1", "Q2"],
  engines: ["duckduckgo"],
  profile: { name: "default" },
  scope: { include: "Libs", exclude: "Non-TS" },
  estimatedCost: { searchCalls: 8, scrapeCalls: 4, description: "~8 searches" },
};

const MOCK_RESULTS: WebSearchResult[] = [
  { title: "XState", url: "https://xstate.js.org", snippet: "State machine lib.", engine: "duckduckgo" },
  { title: "Robot", url: "https://thisrobot.life", snippet: "Lightweight FSM.", engine: "duckduckgo" },
];

function mockSearchFn() { return async () => MOCK_RESULTS; }
function mockScraper(): Scraper {
  const pages = new Map<string, ScrapedPage>();
  pages.set("https://xstate.js.org", { url: "https://xstate.js.org", title: "XState", content: "State machines." });
  pages.set("https://thisrobot.life", { url: "https://thisrobot.life", title: "Robot", content: "Lightweight FSM." });
  return { async scrape(url: string) {
    const p = pages.get(url); if (!p) throw new Error(`No mock for ${url}`); return p;
  }};
}

describe("ResearchStateMachine", () => {
  it("completes full cycle depth=2", async () => {
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let s = ResearchStateMachine.init(MOCK_PLAN);
    assert.equal(s.phase, "searching");

    let r = await machine.next(s, MOCK_PLAN); assert.equal(r.phase, "extracting"); s = r.snapshot;
    assert.equal(s.currentDepth, 1);

    r = await machine.next(s, MOCK_PLAN); assert.equal(r.phase, "questioning"); s = r.snapshot;

    r = await machine.next(s, MOCK_PLAN); assert.equal(r.phase, "extracting"); s = r.snapshot;
    assert.equal(s.currentDepth, 2);

    r = await machine.next(s, MOCK_PLAN); assert.equal(r.phase, "drafting"); s = r.snapshot;

    r = await machine.next(s, MOCK_PLAN, "# Research Report\n\nThis is a comprehensive research report with detailed findings."); assert.equal(r.phase, "saving"); s = r.snapshot;

    r = await machine.next(s, MOCK_PLAN); assert.equal(r.phase, "done");

    r = await machine.next(r.snapshot, MOCK_PLAN); assert.equal(r.phase, "done");
  });

  it("accumulates search calls across iterations", async () => {
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let s = ResearchStateMachine.init(MOCK_PLAN);
    let r = await machine.next(s, MOCK_PLAN);
    const after = r.snapshot.searchCalls;
    assert.ok(after >= 2);
    r = await machine.next(r.snapshot, MOCK_PLAN);
    r = await machine.next(r.snapshot, MOCK_PLAN);
    assert.ok(r.snapshot.searchCalls > after);
  });

  it("generates inject prompts at each phase", async () => {
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    const s = ResearchStateMachine.init(MOCK_PLAN);
    let r = await machine.next(s, MOCK_PLAN); assert.ok(r.inject!.includes("Extraction"));
    r = await machine.next(r.snapshot, MOCK_PLAN); assert.ok(r.inject!.includes("Deepening"));
    r = await machine.next(r.snapshot, MOCK_PLAN); assert.ok(r.inject!.includes("Extraction"));
    r = await machine.next(r.snapshot, MOCK_PLAN); assert.ok(r.inject!.includes("Final Report"));
  });

  it("stays in done on repeated calls", async () => {
    const plan1: ResearchPlan = { ...MOCK_PLAN, profile: { name: "default" }, engines: ["duckduckgo"] };
    // use depth=1 plan
    const depth1Plan: ResearchPlan = { ...MOCK_PLAN, profile: { name: "fast" } };
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let s = ResearchStateMachine.init(depth1Plan);
    s = (await machine.next(s, depth1Plan)).snapshot;
    s = (await machine.next(s, depth1Plan)).snapshot;
    s = (await machine.next(s, depth1Plan, "# Research Report\n\nThis is a comprehensive detailed research report with all findings.")).snapshot;
    s = (await machine.next(s, depth1Plan)).snapshot;
    assert.equal(s.phase, "done");
    const r = await machine.next(s, depth1Plan);
    assert.equal(r.phase, "done");
  });

  it("skips questioning when depth reached", async () => {
    const depth1Plan: ResearchPlan = { ...MOCK_PLAN, profile: { name: "fast" } };
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let s = ResearchStateMachine.init(depth1Plan);
    s = (await machine.next(s, depth1Plan)).snapshot;
    assert.equal(s.phase, "extracting");
    const r = await machine.next(s, depth1Plan);
    assert.equal(r.phase, "drafting", "skip questioning at max depth");
  });

  it("uses provided runId instead of generating a new one", () => {
    const sharedRunId = "shared-run-123";
    const s = ResearchStateMachine.init(MOCK_PLAN, undefined, sharedRunId);
    assert.equal(s.runId, sharedRunId, "must use the provided runId");
  });

  it("generates valid runId when none provided", () => {
    const s = ResearchStateMachine.init(MOCK_PLAN);
    assert.match(s.runId, /^\d{8}-\d{6}$/, "must be YYYYMMDD-HHmmss format");
  });
});
