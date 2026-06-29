import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ResearchStateMachine } from "../extension/state-machine.js";
import { resolveProfile } from "../extension/profile-resolver.js";
import { PrefilterManager } from "../extension/prefilter.js";
import type { ResearchPlan, PrefilterArtifact } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-estimate-and-gate");

function mockSearchFn(results: WebSearchResult[]) {
  return async () => results;
}
function mockScraper(pages: Map<string, ScrapedPage>): Scraper {
  return {
    async scrape(url: string) {
      const page = pages.get(url);
      if (!page) throw new Error(`No mock: ${url}`);
      return page;
    },
  };
}

const MOCK_RESULTS: WebSearchResult[] = [
  { title: "A", url: "https://a.com", snippet: "...", engine: "duckduckgo" },
];

// ─── Fix 1: scrape estimate formula ──────────────────────────────

describe("estimate_research_cost scrape ratio", () => {
  it("scrapes estimate is not double searches (real dedup ~1.4x)", () => {
    // Current: estScrapes = estSearches * 2
    // Real data (12 searches → 17 scrapes = 1.42x)
    // New formula must be ≤ 1.5x to avoid scaring users with 288 scrape estimates
    const plan: ResearchPlan = {
      topic: "test", goal: "test",
      researchQuestions: ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"],
      engines: ["duckduckgo"],
      profile: { name: "deep" },
      scope: { include: "", exclude: "" },
      estimatedCost: { searchCalls: 144, scrapeCalls: 0, description: "" },
    };

    const profile = resolveProfile(plan.profile);
    const estSearches = profile.breadth * profile.depth * plan.researchQuestions.length;
    // 6 * 3 * 8 = 144
    assert.equal(estSearches, 144);

    const estScrapes = estimateScrapeCalls(estSearches, profile.breadth, profile.depth);
    assert.ok(estScrapes < estSearches * 2, `scrapes=${estScrapes} must be < ${estSearches * 2}`);
    assert.ok(estScrapes <= Math.ceil(estSearches * 1.5),
      `scrapes=${estScrapes} must be ≤ ${Math.ceil(estSearches * 1.5)}`);
  });

  it("low breadth+questions still scales reasonably", () => {
    const plan: ResearchPlan = {
      topic: "test", goal: "test",
      researchQuestions: ["q1", "q2", "q3"],
      engines: ["duckduckgo"],
      profile: { name: "fast" },
      scope: { include: "", exclude: "" },
      estimatedCost: { searchCalls: 6, scrapeCalls: 0, description: "" },
    };
    const profile = resolveProfile(plan.profile);
    const estSearches = profile.breadth * profile.depth * plan.researchQuestions.length;
    // 2 * 1 * 3 = 6
    assert.equal(estSearches, 6);

    const estScrapes = estimateScrapeCalls(estSearches, profile.breadth, profile.depth);
    assert.ok(estScrapes > 0);
    assert.ok(estScrapes <= estSearches * 2);
  });
});

// ─── Fix 2: confirmation gate ────────────────────────────────────

describe("run_research confirmation gate", () => {
  beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  function createArtifact(planOverrides?: Partial<ResearchPlan>): string {
    const artifactsDir = join(TEST_DIR, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });

    const plan: ResearchPlan = {
      topic: "test", goal: "test",
      researchQuestions: ["q1"],
      engines: ["duckduckgo"],
      profile: { name: "default" },
      scope: { include: "a", exclude: "b" },
      estimatedCost: { searchCalls: 4, scrapeCalls: 4, description: "" },
      ...planOverrides,
    };

    const artifact: PrefilterArtifact = {
      version: 1,
      runId: "test-run",
      createdAt: new Date().toISOString(),
      inputTopic: "test",
      plan,
      preliminarySearch: { query: "test", resultsCount: 0, scrapedUrls: [] },
    };

    const path = join(artifactsDir, "test-prefilter.json");
    writeFileSync(path, JSON.stringify(artifact, null, 2), "utf-8");
    return path;
  }

  it("confirmResearchPlan stores confirmation marker in state", () => {
    // After user confirms, confirmResearchPlan sets a marker
    // This can be verified by checking the confirmation state
    const confirmed = checkConfirmationState([]);
    assert.equal(confirmed, false, "no entries → not confirmed");

    const confirmedEntries = [
      { customType: "deep-research:plan-confirmed", data: { planArtifactPath: "/tmp/test.json" } }
    ];
    assert.equal(checkConfirmationState(confirmedEntries), true);
  });

  it("validateRunResearch rejects unconfirmed plan", () => {
    const artifactPath = createArtifact();
    const entries: Array<{ customType?: string; data?: Record<string, unknown> }> = [];

    const result = validateRunResearchGate(artifactPath, entries);
    assert.equal(result.allowed, false, "must reject unconfirmed plan");
    assert.ok(result.reason!.includes("confirm") || result.reason!.includes("user"),
      `reason must mention confirmation, got: ${result.reason}`);
  });

  it("validateRunResearch allows confirmed plan", () => {
    const artifactPath = createArtifact();
    const entries = [
      { customType: "deep-research:plan-confirmed", data: { planArtifactPath: artifactPath } }
    ];

    const result = validateRunResearchGate(artifactPath, entries);
    assert.equal(result.allowed, true);
  });

  it("validateRunResearch rejects when confirmed for different plan", () => {
    const artifactPath = createArtifact();
    const entries = [
      { customType: "deep-research:plan-confirmed", data: { planArtifactPath: "/other/plan.json" } }
    ];

    const result = validateRunResearchGate(artifactPath, entries);
    assert.equal(result.allowed, false, "must reject — confirmation is for different plan");
  });
});

// ─── Stub implementations (to be moved to extension) ─────────────

function estimateScrapeCalls(estSearches: number, breadth: number, depth: number): number {
  // Each depth iteration scrapes up to breadth*2 URLs, but heavy dedup across
  // questions and iterations. Real ratio observed: ~1.4x (12 searches → 17 scrapes).
  // Formula: ceil(searches * 1.5) as conservative upper bound.
  return Math.ceil(estSearches * 1.5);
}

const CONFIRMATION_KEY = "deep-research:plan-confirmed";

function checkConfirmationState(
  entries: Array<{ customType?: string; data?: Record<string, unknown> }>,
): boolean {
  return entries.some((e) => e.customType === CONFIRMATION_KEY);
}

function validateRunResearchGate(
  planArtifactPath: string,
  entries: Array<{ customType?: string; data?: Record<string, unknown> }>,
): { allowed: boolean; reason?: string } {
  const confirmation = [...entries].reverse().find((e) => e.customType === CONFIRMATION_KEY);
  if (!confirmation) {
    return { allowed: false, reason: "Research plan not confirmed by user. Present the plan and cost estimate, ask for explicit approval, then call confirm_research before run_research." };
  }
  const confirmedPath = confirmation.data?.planArtifactPath as string | undefined;
  if (confirmedPath && confirmedPath !== planArtifactPath) {
    return { allowed: false, reason: `Confirmation is for a different plan (${confirmedPath}). Re-confirm this plan.` };
  }
  return { allowed: true };
}
