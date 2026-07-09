import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResearchPlan } from "../extension/prefilter.js";
import { ProfileResolver } from "../extension/profile-resolver.js";
import type { ScrapedPage, Scraper } from "../extension/scraper.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import { SearchProviderCredentials } from "../extension/settings-context.js";
import { ResearchStateMachine } from "../extension/state-machine.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "test",
  goal: "test",
  researchQuestions: ["q1"],
  engines: ["brave"],
  profile: { name: "default" },
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
};

describe("credentials passed to searchWeb from state machine", () => {
  it("doSearching includes credentials in callbacks when searchCred provided", async () => {
    const prev = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    try {
      let capturedCredentials: SearchProviderCredentials | undefined;

      const mockSearch = async (_q: string, _n: number, _e: string[], cb?: any) => {
        capturedCredentials = cb?.credentials;
        return [] as WebSearchResult[];
      };

      const mockScraper: Scraper = {
        async scrape() {
          throw new Error("no mock");
        },
      };

      const cred = new SearchProviderCredentials({
        brave: { apiKey: "bsa-from-settings" },
      });

      const machine = new ResearchStateMachine({ searchFn: mockSearch, scraper: mockScraper, searchCred: cred });
      const snapshot = ResearchStateMachine.init(MOCK_PLAN, new ProfileResolver({}, "default"));

      await machine.next(snapshot, MOCK_PLAN);

      assert.ok(capturedCredentials, "credentials must be passed to searchWeb callbacks");
      assert.equal(capturedCredentials?.get("brave", "apiKey"), "bsa-from-settings");
    } finally {
      if (prev) process.env.BRAVE_API_KEY = prev;
    }
  });

  it("credentials is undefined in callbacks when searchCred not provided", async () => {
    let capturedCredentials: any = "NOT_UNDEFINED";

    const mockSearch = async (_q: string, _n: number, _e: string[], cb?: any) => {
      capturedCredentials = cb?.credentials;
      return [] as WebSearchResult[];
    };

    const mockScraper: Scraper = {
      async scrape() {
        throw new Error("no mock");
      },
    };

    const machine = new ResearchStateMachine({ searchFn: mockSearch, scraper: mockScraper });
    const snapshot = ResearchStateMachine.init(MOCK_PLAN, new ProfileResolver({}, "default"));

    await machine.next(snapshot, MOCK_PLAN);

    assert.equal(capturedCredentials, undefined, "credentials must be undefined when no searchCred in constructor");
  });
});
