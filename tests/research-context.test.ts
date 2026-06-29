import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchPlan, ResearchPlanProfile } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper } from "../extension/scraper.js";
import { SearchProviderCredentials } from "../extension/search-providers.js";
import type { Logger } from "../extension/logger.js";
import type { ResearchProfile } from "../extension/state-machine.js";

// ─── Candidate 1: ResearchContext bundles constructor params ─────

describe("ResearchContext — bundled constructor", () => {
  const mockSearch = async () => [] as WebSearchResult[];
  const mockScraper: Scraper = { async scrape() { throw new Error("no mock"); } };
  const mockPlan: ResearchPlan = {
    topic: "test", goal: "test", researchQuestions: ["q1"],
    engines: ["duckduckgo"], profile: { name: "default" },
    scope: { include: "", exclude: "" },
    estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
  };

  it("accepts context object instead of positional params", () => {
    const machine = new ResearchStateMachine({
      searchFn: mockSearch,
      scraper: mockScraper,
    });
    const snap = ResearchStateMachine.init(mockPlan);
    assert.equal(snap.phase, "searching");
  });

  it("optional fields are undefined when not provided", async () => {
    const machine = new ResearchStateMachine({
      searchFn: mockSearch,
      scraper: mockScraper,
    });
    const snap = ResearchStateMachine.init(mockPlan);
    const result = await machine.next(snap, mockPlan);
    // Should not throw — optional deps gracefully absent
    assert.ok(result.phase === "extracting" || result.phase === "drafting");
  });

  it("accepts all optional fields", async () => {
    const presets: Record<string, ResearchProfile> = {
      default: { breadth: 4, depth: 2, concurrency: 4 },
      custom: { breadth: 3, depth: 2, concurrency: 2 },
    };
    const cred = new SearchProviderCredentials({ brave: { apiKey: "k" } });

    const machine = new ResearchStateMachine({
      searchFn: mockSearch,
      scraper: mockScraper,
      profilePresets: presets,
      logger: undefined,
      artifactsDir: "/tmp/artifacts",
      searchCred: cred,
    });
    const snap = ResearchStateMachine.init(mockPlan, presets);
    assert.equal(snap.profile?.breadth, 4, "init uses presets");
  });
});
