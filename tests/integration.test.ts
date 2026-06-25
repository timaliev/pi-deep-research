import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PrefilterManager } from "../extension/prefilter.js";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { ResearchProfile } from "../extension/state-machine.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "../test-integration");

const MOCK_PROFILE: ResearchProfile = { breadth: 2, depth: 2, concurrency: 1 };

const DEFAULT_RESULTS: WebSearchResult[] = [
  { title: "XState Docs", url: "https://xstate.js.org", snippet: "State machines for JS/TS.", engine: "duckduckgo" },
  { title: "Robot FSM", url: "https://thisrobot.life", snippet: "Lightweight FSM library.", engine: "duckduckgo" },
];

const DEFAULT_SCRAPED: Record<string, ScrapedPage> = {
  "https://xstate.js.org": {
    url: "https://xstate.js.org",
    title: "XState Docs",
    content: "XState is a library for creating, interpreting, and executing finite state machines and statecharts.",
  },
  "https://thisrobot.life": {
    url: "https://thisrobot.life",
    title: "Robot FSM",
    content: "Robot aims to be a lightweight, functional, and composable state machine library.",
  },
};

function mockSearchFn() {
  return async (_query: string, _max?: number) => DEFAULT_RESULTS;
}

function mockScraper(): Scraper {
  return {
    async scrape(url: string) {
      const page = DEFAULT_SCRAPED[url];
      if (!page) {
        return { url, title: url.replace("https://", "").split("/")[0], content: "Mock content for " + url };
      }
      return page;
    },
  };
}

const VALID_PLAN_JSON = JSON.stringify({
  topic: "State machine libraries in TypeScript",
  goal: "Compare state machine libraries for TypeScript applications and recommend the best fit for different use cases",
  researchQuestions: [
    "What are the most popular TypeScript state machine libraries?",
    "How does XState compare to lightweight alternatives like Robot?",
    "What patterns work best for complex vs simple state management?",
  ],
  scope: {
    include: "TypeScript libraries, performance, bundle size, API design, React integration",
    exclude: "Non-TypeScript implementations, general CS theory, Redux-thunk patterns",
  },
  estimatedCost: {
    searchCalls: 18,
    scrapeCalls: 12,
    description: "~18 searches, ~12 scrapes across depth=2, breadth=2",
  },
});

describe("Integration: full research pipeline", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("plan phase: start → agent generates plan → finalize → artifact saved", async () => {
    const artifactsDir = join(TEST_DIR, "artifacts");
    const manager = new PrefilterManager(mockSearchFn(), mockScraper(), artifactsDir);

    const startResult = await manager.start("state machine libraries in TypeScript");
    assert.equal(startResult.phase, "awaiting_plan");
    assert.ok(startResult.inject, "should have inject prompt");
    assert.ok(startResult.searchResults!.length > 0, "should have search results");
    assert.ok(startResult.scrapedContent!.length > 0, "should have scraped content");

    assert.ok(startResult.inject!.includes("XState"), "inject should mention XState from search");
    assert.ok(startResult.inject!.includes("JSON"), "inject should request JSON");

    const finalizeResult = await manager.finalize(
      "state machine libraries in TypeScript",
      VALID_PLAN_JSON
    );
    assert.equal(finalizeResult.phase, "plan_ready");
    assert.ok(finalizeResult.planArtifactPath, "should have artifact path");
    assert.ok(existsSync(finalizeResult.planArtifactPath!), "artifact file must exist");

    const artifactRaw = readFileSync(finalizeResult.planArtifactPath!, "utf-8");
    const artifact = JSON.parse(artifactRaw);
    assert.equal(artifact.version, 1);
    assert.equal(artifact.plan.researchQuestions.length, 3);
    assert.equal(artifact.plan.topic, "State machine libraries in TypeScript");
  });

  it("run phase: state machine completes full cycle → done", async () => {
    const artifactsDir = join(TEST_DIR, "artifacts");
    const reportsDir = join(TEST_DIR, "reports");
    mkdirSync(reportsDir, { recursive: true });

    const manager = new PrefilterManager(mockSearchFn(), mockScraper(), artifactsDir);
    await manager.start("state machines");
    const planResult = await manager.finalize("state machines", VALID_PLAN_JSON);
    assert.equal(planResult.phase, "plan_ready");

    const plan: ResearchPlan = planResult.plan!;

    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), MOCK_PROFILE);
    let snapshot = ResearchStateMachine.init(plan, MOCK_PROFILE);

    assert.equal(snapshot.phase, "searching");
    assert.equal(snapshot.currentDepth, 0);
    assert.equal(snapshot.totalDepth, 2);

    let r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "extracting");
    assert.ok(r.inject, "extraction inject expected");
    assert.equal(r.snapshot.currentDepth, 1);
    assert.ok(r.snapshot.searchCalls >= 1, "search calls should be > 0");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "questioning");
    assert.ok(r.inject!.includes("Deepening"), "should ask follow-up questions");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "extracting");
    assert.ok(r.inject!.includes("Extraction"), "extraction inject for depth 2");
    assert.equal(r.snapshot.currentDepth, 2);
    assert.ok(r.snapshot.searchCalls > snapshot.searchCalls, "search calls accumulated");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "drafting");
    assert.ok(r.inject!.includes("Final Report"), "drafting inject");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "saving");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "done");
    assert.ok(r.snapshot.searchCalls >= 2, "total search calls across all iterations");
    assert.ok(r.snapshot.allVisitedUrls.length >= 1, "should have visited URLs");
  });

  it("end-to-end: plan → run → done, all in sequence", async () => {
    const artifactsDir = join(TEST_DIR, "artifacts");
    const reportsDir = join(TEST_DIR, "reports");
    mkdirSync(reportsDir, { recursive: true });

    const manager = new PrefilterManager(mockSearchFn(), mockScraper(), artifactsDir);

    const startResult = await manager.start("state machines in typescript");
    assert.equal(startResult.phase, "awaiting_plan");
    assert.ok(startResult.searchResults!.length > 0);

    const planResult = await manager.finalize("state machines in typescript", VALID_PLAN_JSON);
    assert.equal(planResult.phase, "plan_ready");
    const plan: ResearchPlan = planResult.plan!;

    const machine = new ResearchStateMachine(mockSearchFn(), mockScraper(), MOCK_PROFILE);
    let snapshot = ResearchStateMachine.init(plan, MOCK_PROFILE);

    const phases: string[] = [];
    let totalInjectCount = 0;

    for (let i = 0; i < 10; i++) {
      const r = await machine.next(snapshot, plan);
      snapshot = r.snapshot;
      phases.push(r.phase);
      if (r.inject) totalInjectCount++;
      if (r.phase === "done") break;
    }

    assert.equal(snapshot.phase, "done", "must reach done phase");
    assert.ok(phases.includes("extracting"), "should pass through extracting");
    assert.ok(phases.includes("drafting"), "should pass through drafting");
    assert.ok(totalInjectCount >= 2, "should have at least 2 inject prompts");
    assert.ok(snapshot.searchCalls >= 2, "should have made multiple search calls");
    assert.ok(snapshot.allVisitedUrls.length >= 2, "should have visited multiple URLs");
  });
});
