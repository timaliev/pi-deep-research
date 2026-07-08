import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrefilterManager } from "../extension/prefilter.js";
import { SearchProviderCredentials } from "../extension/settings-context.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-check-api-keys");

function mockSearchFn() { return async () => [] as WebSearchResult[]; }
function mockScraper(): Scraper {
  return { async scrape() { throw new Error("no mock"); } };
}

describe("checkApiKeys with SearchProviderCredentials", () => {
  beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("passes when credentials found in settings", async () => {
    const cred = new SearchProviderCredentials({
      brave: { apiKey: "bsa-key" },
    });

    const manager = new PrefilterManager(mockSearchFn(), mockScraper(), TEST_DIR, undefined, undefined, cred);
    const result = await manager.withParams("test", ["brave"], { name: "default" });

    assert.notEqual(result.phase, "awaiting_params",
      "must NOT loop back — credentials found in settings");
  });

  it("rejects when credentials missing from both settings and env", async () => {
    const prev = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    try {
      const cred = new SearchProviderCredentials({});

      const manager = new PrefilterManager(mockSearchFn(), mockScraper(), TEST_DIR, undefined, undefined, cred);
      const result = await manager.withParams("test", ["brave"], { name: "default" });

      assert.equal(result.phase, "awaiting_params",
        "must loop back when brave selected but no api key");
      assert.ok(result.inject!.includes("BRAVE_API_KEY"),
        `must mention missing key, got: ${result.inject}`);
    } finally {
      if (prev) process.env.BRAVE_API_KEY = prev;
    }
  });

  it("passes when credentials in env override empty settings", async () => {
    const prev = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "env-bsa";
    const cred = new SearchProviderCredentials({});

    const manager = new PrefilterManager(mockSearchFn(), mockScraper(), TEST_DIR, undefined, undefined, cred);
    const result = await manager.withParams("test", ["brave"], { name: "default" });

    // Should pass because env var is set
    assert.notEqual(result.phase, "awaiting_params",
      "env var must satisfy credential check");

    if (prev) process.env.BRAVE_API_KEY = prev; else delete process.env.BRAVE_API_KEY;
  });
});
