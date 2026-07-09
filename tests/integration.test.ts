import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ResearchPlan } from "../extension/prefilter.js";
import { PrefilterManager } from "../extension/prefilter.js";
import { ProfileResolver } from "../extension/profile-resolver.js";
import { ResearchDraft } from "../extension/research-draft.js";
import type { ScrapedPage, Scraper } from "../extension/scraper.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import { ResearchStateMachine } from "../extension/state-machine.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "../test-integration");

const DEFAULT_RESULTS: WebSearchResult[] = [
  { title: "XState Docs", url: "https://xstate.js.org", snippet: "State machines for JS/TS.", engine: "duckduckgo" },
  { title: "Robot FSM", url: "https://thisrobot.life", snippet: "Lightweight FSM library.", engine: "duckduckgo" },
];

const DEFAULT_SCRAPED: Record<string, ScrapedPage> = {
  "https://xstate.js.org": {
    url: "https://xstate.js.org",
    title: "XState Docs",
    content: "XState is a library for finite state machines.",
  },
  "https://thisrobot.life": {
    url: "https://thisrobot.life",
    title: "Robot FSM",
    content: "Robot is a lightweight state machine library.",
  },
};

function mockSearchFn() {
  return async () => DEFAULT_RESULTS;
}
function mockScraper(): Scraper {
  return {
    async scrape(url: string) {
      return DEFAULT_SCRAPED[url] ?? { url, title: url, content: "mock" };
    },
  };
}

const VALID_PLAN_JSON = JSON.stringify({
  topic: "State machine libraries in TypeScript",
  goal: "Compare state machine libraries",
  researchQuestions: ["Q1", "Q2", "Q3"],
  engines: ["duckduckgo"],
  profile: { name: "default" },
  scope: { include: "TS libraries", exclude: "Non-TS" },
  estimatedCost: { searchCalls: 18, scrapeCalls: 12, description: "~18 searches" },
});

describe("Integration: full research pipeline", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("three-step prefilter: start → withParams → finalize → artifact saved", async () => {
    const artifactsDir = join(TEST_DIR, "artifacts");
    const manager = new PrefilterManager(mockSearchFn(), mockScraper(), artifactsDir);

    // Step 1: start → params prompt
    const r1 = await manager.start("state machine libraries");
    assert.equal(r1.phase, "awaiting_params");
    assert.ok(r1.inject!.includes("engines"));

    // Step 2: withParams → prelim search → plan prompt
    const r2 = await manager.withParams("state machine libraries", ["duckduckgo"], { name: "default" });
    assert.equal(r2.phase, "awaiting_plan");
    assert.ok(r2.searchResults!.length > 0);
    assert.ok(r2.scrapedContent!.length > 0);
    assert.ok(r2.inject!.includes("XState"));

    // Step 3: finalize → plan saved
    const r3 = await manager.finalize("state machine libraries", VALID_PLAN_JSON);
    assert.equal(r3.phase, "plan_ready");
    assert.ok(r3.planArtifactPath);
    assert.ok(existsSync(r3.planArtifactPath!));

    const artifact = JSON.parse(readFileSync(r3.planArtifactPath!, "utf-8"));
    assert.equal(artifact.plan.engines[0], "duckduckgo");
  });

  it("run phase: state machine completes full cycle → done", async () => {
    const artifactsDir = join(TEST_DIR, "artifacts");
    const manager = new PrefilterManager(mockSearchFn(), mockScraper(), artifactsDir);
    await manager.start("state machines");
    await manager.withParams("state machines", ["duckduckgo"], { name: "default" });
    const planResult = await manager.finalize("state machines", VALID_PLAN_JSON);
    assert.equal(planResult.phase, "plan_ready");
    const plan: ResearchPlan = planResult.plan!;

    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let snapshot = ResearchStateMachine.init(plan, new ProfileResolver({}, "default"));

    assert.equal(snapshot.phase, "searching");
    let r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "extracting");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "questioning");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "extracting");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "drafting");
    snapshot = r.snapshot;

    // Agent responds with report text (can be content blocks array in real pi)
    r = await machine.next(snapshot, plan, "# F1 Technical Regulations\n\nThe 2026 regulations...");
    assert.equal(r.phase, "saving");
    assert.ok(r.snapshot.draft.get().length > 50, "draft must be populated");
    assert.ok(r.snapshot.draft.get().includes("2026"), "draft must contain report text");
    snapshot = r.snapshot;

    r = await machine.next(snapshot, plan);
    assert.equal(r.phase, "done");
    assert.ok(r.snapshot.searchCalls >= 2);
  });

  it("drafting phase re-injects prompt when agent response is empty", async () => {
    const plan: ResearchPlan = {
      topic: "test",
      goal: "test",
      researchQuestions: ["q"],
      engines: ["duckduckgo"],
      profile: { name: "default" },
      scope: { include: "", exclude: "" },
      estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
    };
    const snapshot = ResearchStateMachine.init(plan, new ProfileResolver({}, "default"));
    const machine = new ResearchStateMachine({ searchFn: mockSearchFn([]), scraper: mockScraper() });

    // Advance to drafting
    let r = await machine.next(snapshot, plan);
    r = await machine.next(r.snapshot, plan);
    r = await machine.next(r.snapshot, plan);
    r = await machine.next(r.snapshot, plan);
    assert.equal(r.phase, "drafting");

    // Empty agent response (like when agent calls tools instead of writing report)
    r = await machine.next(r.snapshot, plan, "");
    assert.equal(r.phase, "drafting", "must stay in drafting when response is empty");
    assert.ok(r.inject, "must re-inject drafting prompt");
    assert.ok(
      r.inject!.includes("Write the final report") || r.inject!.includes("Write the report"),
      "re-injection must ask for report",
    );
    assert.ok(
      r.inject!.includes("Do NOT call") || r.inject!.includes("not call"),
      "re-injection must say not to call tools",
    );
  });

  it("end-to-end: plan → run → done", async () => {
    const artifactsDir = join(TEST_DIR, "artifacts");
    const reportsDir = join(TEST_DIR, "reports");
    mkdirSync(reportsDir, { recursive: true });

    const manager = new PrefilterManager(mockSearchFn(), mockScraper(), artifactsDir);
    await manager.start("ts state machines");
    const r2 = await manager.withParams("ts state machines", ["duckduckgo"], { name: "fast" });
    assert.equal(r2.phase, "awaiting_plan");
    const r3 = await manager.finalize("ts state machines", VALID_PLAN_JSON);
    assert.equal(r3.phase, "plan_ready");
    const plan: ResearchPlan = r3.plan!;

    const machine = new ResearchStateMachine({ searchFn: mockSearchFn(), scraper: mockScraper() });
    let snapshot = ResearchStateMachine.init(plan, new ProfileResolver({}, "default"));

    let totalInjectCount = 0;
    for (let i = 0; i < 10; i++) {
      // Provide mock report text when drafting phase expects it
      const agentResponse =
        snapshot.phase === "drafting"
          ? "# Test Report\n\nThis is a comprehensive research report about state machines. It covers all key findings and analysis."
          : undefined;
      const r = await machine.next(snapshot, plan, agentResponse);
      snapshot = r.snapshot;
      if (r.inject) totalInjectCount++;
      if (r.phase === "done") break;
    }
    assert.equal(snapshot.phase, "done");
    assert.ok(totalInjectCount >= 2);
    assert.ok(snapshot.searchCalls >= 2);
  });
});
