import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveBraveApiKey, buildBraveSearchParams, parseBraveResponse } from "../extension/search/engines/brave.js";
import type { SearchProviderCredentials } from "../extension/settings-context.js";

describe("searchBrave credentials", () => {
  it("reads api key from SearchProviderCredentials when no env var", () => {
    const cred = { get: () => "bsa-from-settings" } as any as SearchProviderCredentials;
    const key = resolveBraveApiKey(cred);
    assert.equal(key, "bsa-from-settings");
  });

  it("env var wins over credentials", () => {
    const prev = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "bsa-from-env";
    const cred = { get: () => "bsa-from-settings" } as any as SearchProviderCredentials;
    const key = resolveBraveApiKey(cred);
    assert.equal(key, "bsa-from-env");
    if (prev) process.env.BRAVE_API_KEY = prev; else delete process.env.BRAVE_API_KEY;
  });

  it("returns undefined when no source has key", () => {
    const cred = { get: () => undefined } as any as SearchProviderCredentials;
    const key = resolveBraveApiKey(cred);
    assert.equal(key, undefined);
  });
});

describe("buildBraveSearchParams", () => {
  it("builds URL with query and count", () => {
    const params = buildBraveSearchParams("test query", 5, {});
    assert.ok(params.url.includes("q=test+query"));
    assert.ok(params.url.includes("count=5"));
  });

  it("includes freshness when specified", () => {
    const params = buildBraveSearchParams("test", 5, { freshness: "pw" });
    assert.ok(params.url.includes("freshness=pw"));
  });

  it("includes country and search_lang", () => {
    const params = buildBraveSearchParams("test", 5, { country: "DE", searchLang: "de" });
    assert.ok(params.url.includes("country=DE"));
    assert.ok(params.url.includes("search_lang=de"));
  });

  it("includes extra_snippets when true", () => {
    const params = buildBraveSearchParams("test", 5, { extraSnippets: true });
    assert.ok(params.url.includes("extra_snippets=true"));
  });

  it("does not include optional params when not specified", () => {
    const params = buildBraveSearchParams("test", 5, {});
    assert.ok(!params.url.includes("freshness"));
    assert.ok(!params.url.includes("country"));
    assert.ok(!params.url.includes("extra_snippets"));
  });

  it("clamps count to max 20", () => {
    const params = buildBraveSearchParams("test", 50, {});
    assert.ok(params.url.includes("count=20"), "count must be clamped to 20");
  });
});

describe("parseBraveResponse", () => {
  it("parses web results from Brave API response", () => {
    const body = JSON.stringify({
      web: {
        results: [
          { title: "Page 1", url: "https://a.com", description: "Desc 1" },
          { title: "Page 2", url: "https://b.com", description: "Desc 2" },
        ],
      },
    });
    const results = parseBraveResponse(body, 5);
    assert.equal(results.length, 2);
    assert.equal(results[0].title, "Page 1");
    assert.equal(results[0].engine, "brave");
  });

  it("handles empty results", () => {
    const results = parseBraveResponse(JSON.stringify({ web: { results: [] } }), 5);
    assert.deepEqual(results, []);
  });

  it("handles malformed JSON gracefully", () => {
    const results = parseBraveResponse("not json", 5);
    assert.deepEqual(results, []);
  });

  it("respects maxResults limit", () => {
    const body = JSON.stringify({
      web: {
        results: [
          { title: "1", url: "https://1.com", description: "" },
          { title: "2", url: "https://2.com", description: "" },
          { title: "3", url: "https://3.com", description: "" },
        ],
      },
    });
    const results = parseBraveResponse(body, 2);
    assert.equal(results.length, 2);
  });
});
