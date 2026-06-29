import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";
import { SearchProviderCredentials } from "../extension/search-providers.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "test", goal: "test", researchQuestions: ["q1"],
  engines: ["brave"], profile: { name: "default" },
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
};

describe("credentials passed to searchWeb from state machine", () => {
  it("doSearching includes credentials in callbacks when searchCred provided", async () => {
    let capturedCredentials: SearchProviderCredentials | undefined;

    const mockSearch = async (_q: string, _n: number, _e: string[], cb?: any) => {
      capturedCredentials = cb?.credentials;
      return [] as WebSearchResult[];
    };

    const mockScraper: Scraper = {
      async scrape() { throw new Error("no mock"); },
    };

    const cred = new SearchProviderCredentials({
      brave: { apiKey: "bsa-from-settings" },
    });

    const machine = new ResearchStateMachine(mockSearch, mockScraper, undefined, undefined, undefined, cred);
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);

    await machine.next(snapshot, MOCK_PLAN);

    assert.ok(capturedCredentials, "credentials must be passed to searchWeb callbacks");
    assert.equal(capturedCredentials?.get("brave", "apiKey"), "bsa-from-settings");
  });

  it("credentials is undefined in callbacks when searchCred not provided", async () => {
    let capturedCredentials: any = "NOT_UNDEFINED";

    const mockSearch = async (_q: string, _n: number, _e: string[], cb?: any) => {
      capturedCredentials = cb?.credentials;
      return [] as WebSearchResult[];
    };

    const mockScraper: Scraper = {
      async scrape() { throw new Error("no mock"); },
    };

    const machine = new ResearchStateMachine(mockSearch, mockScraper);
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);

    await machine.next(snapshot, MOCK_PLAN);

    assert.equal(capturedCredentials, undefined,
      "credentials must be undefined when no searchCred in constructor");
  });
});
