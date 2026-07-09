import assert from "node:assert/strict";
import { describe, it } from "node:test";

// --- What engine adapters must expose ---
// Each adapter file exports: { search(query, opts, cred?) }

describe("engine adapters — TDD spec", () => {
  it("duckduckgo adapter exports search function", async () => {
    const mod = await import("../extension/search/engines/duckduckgo.js");
    assert.equal(typeof mod.searchDuckDuckGo, "function");
  });

  it("brave adapter exports search function", async () => {
    const mod = await import("../extension/search/engines/brave.js");
    assert.equal(typeof mod.searchBrave, "function");
  });

  it("tavily adapter exports search function", async () => {
    const mod = await import("../extension/search/engines/tavily.js");
    assert.equal(typeof mod.searchTavily, "function");
  });

  it("yandex adapter exports search function", async () => {
    const mod = await import("../extension/search/engines/yandex.js");
    assert.equal(typeof mod.searchYandex, "function");
  });

  it("searxng adapter exports search function", async () => {
    const mod = await import("../extension/search/engines/searxng.js");
    assert.equal(typeof mod.searchSearXNG, "function");
  });
});

describe("createEngineAdapter factory", () => {
  it("returns adapter for duckduckgo", async () => {
    const { createEngineSearchFn } = await import("../extension/search/web-search.js");
    const fn = createEngineSearchFn("duckduckgo");
    assert.equal(typeof fn, "function");
  });

  it("returns adapter for brave", async () => {
    const { createEngineSearchFn } = await import("../extension/search/web-search.js");
    const fn = createEngineSearchFn("brave");
    assert.equal(typeof fn, "function");
  });

  it("returns adapter for tavily", async () => {
    const { createEngineSearchFn } = await import("../extension/search/web-search.js");
    const fn = createEngineSearchFn("tavily");
    assert.equal(typeof fn, "function");
  });

  it("returns adapter for yandex", async () => {
    const { createEngineSearchFn } = await import("../extension/search/web-search.js");
    const fn = createEngineSearchFn("yandex");
    assert.equal(typeof fn, "function");
  });

  it("returns adapter for searxng", async () => {
    const { createEngineSearchFn } = await import("../extension/search/web-search.js");
    const fn = createEngineSearchFn("searxng");
    assert.equal(typeof fn, "function");
  });

  it("returns empty results for unknown engine", async () => {
    const { createEngineSearchFn } = await import("../extension/search/web-search.js");
    const fn = createEngineSearchFn("nonexistent" as any);
    const results = await fn("test", { query: "test" }, undefined);
    assert.deepEqual(results, []);
  });
});

describe("searchWeb dispatches through adapter factory", () => {
  it("searchWeb with duckduckgo calls adapter", async () => {
    const { searchWeb } = await import("../extension/search/web-search.js");
    const results = await searchWeb("test query", 2, ["duckduckgo"]);
    assert.ok(Array.isArray(results));
    if (results.length > 0) {
      assert.ok(results[0].title !== undefined);
      assert.ok(results[0].url !== undefined);
    }
  });

  it("searchWeb with unknown engine returns empty", async () => {
    const { searchWeb } = await import("../extension/search/web-search.js");
    const results = await searchWeb("test", 2, ["nonexistent" as any]);
    assert.deepEqual(results, []);
  });
});
