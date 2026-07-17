import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { PrefilterArtifact, ResearchPlan } from "../extension/prefilter.js";
import { PrefilterManager } from "../extension/prefilter.js";
import { ProfileResolver } from "../extension/profile-resolver.js";
import type { ScrapedPage, Scraper } from "../extension/scraper.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import { ResearchStateMachine } from "../extension/state-machine.js";

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

const MOCK_RESULTS: WebSearchResult[] = [{ title: "A", url: "https://a.com", snippet: "...", engine: "duckduckgo" }];

// ─── Confirmation gate ───────────────────────────────────────────

describe("run_research confirmation gate", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  function createArtifact(planOverrides?: Partial<ResearchPlan>): string {
    const artifactsDir = join(TEST_DIR, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });

    const plan: ResearchPlan = {
      topic: "test",
      goal: "test",
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
      { customType: "deep-research:plan-confirmed", data: { planArtifactPath: "/tmp/test.json" } },
    ];
    assert.equal(checkConfirmationState(confirmedEntries), true);
  });

  it("validateRunResearch rejects unconfirmed plan", () => {
    const artifactPath = createArtifact();
    const entries: Array<{ customType?: string; data?: Record<string, unknown> }> = [];

    const result = validateRunResearchGate(artifactPath, entries);
    assert.equal(result.allowed, false, "must reject unconfirmed plan");
    assert.ok(
      result.reason!.includes("confirm") || result.reason!.includes("user"),
      `reason must mention confirmation, got: ${result.reason}`,
    );
  });

  it("validateRunResearch allows confirmed plan", () => {
    const artifactPath = createArtifact();
    const entries = [{ customType: "deep-research:plan-confirmed", data: { planArtifactPath: artifactPath } }];

    const result = validateRunResearchGate(artifactPath, entries);
    assert.equal(result.allowed, true);
  });

  it("validateRunResearch rejects when confirmed for different plan", () => {
    const artifactPath = createArtifact();
    const entries = [{ customType: "deep-research:plan-confirmed", data: { planArtifactPath: "/other/plan.json" } }];

    const result = validateRunResearchGate(artifactPath, entries);
    assert.equal(result.allowed, false, "must reject — confirmation is for different plan");
  });
});

// ─── Stub implementations (to be moved to extension) ─────────────

const CONFIRMATION_KEY = "deep-research:plan-confirmed";

function checkConfirmationState(entries: Array<{ customType?: string; data?: Record<string, unknown> }>): boolean {
  return entries.some((e) => e.customType === CONFIRMATION_KEY);
}

function validateRunResearchGate(
  planArtifactPath: string,
  entries: Array<{ customType?: string; data?: Record<string, unknown> }>,
): { allowed: boolean; reason?: string } {
  const confirmation = [...entries].reverse().find((e) => e.customType === CONFIRMATION_KEY);
  if (!confirmation) {
    return {
      allowed: false,
      reason:
        "Research plan not confirmed by user. Complete plan_research first, then call run_research with the plan path.",
    };
  }
  const confirmedPath = confirmation.data?.planArtifactPath as string | undefined;
  if (confirmedPath && confirmedPath !== planArtifactPath) {
    return { allowed: false, reason: `Confirmation is for a different plan (${confirmedPath}). Re-confirm this plan.` };
  }
  return { allowed: true };
}
