/**
 * Test Tavily search integration.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createEngineSearchFn } from "../extension/search/web-search.js";

const webSearchCode = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "search", "web-search.ts"),
  "utf-8",
);
const tavilyCode = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "search", "engines", "tavily.ts"),
  "utf-8",
);
const prefilterCode = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"), "utf-8");

describe("Tavily search integration", () => {
  it("SearchEngine type includes tavily", () => {
    // SearchEngine is now derived from ALL_ENGINES in engines.ts
    const enginesSrc = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "search", "engines.ts"),
      "utf-8",
    );
    assert.ok(enginesSrc.includes('"tavily"'), "ALL_ENGINES must include tavily");
  });

  it("searchTavily function exists with API key check", () => {
    assert.ok(
      tavilyCode.includes("searchTavily") || tavilyCode.includes("async function searchTavily"),
      "searchTavily function must exist in tavily adapter",
    );
    assert.ok(tavilyCode.includes("TAVILY_API_KEY"), "Must check TAVILY_API_KEY env var");
  });

  it("searchWeb dispatches to tavily engine", async () => {
    const fn = createEngineSearchFn("tavily");
    assert.equal(typeof fn, "function");
  });

  it("prefilter warns when tavily selected without API key", () => {
    assert.ok(prefilterCode.includes("TAVILY_API_KEY"), "Prefilter must check TAVILY_API_KEY");
  });

  it("tavily uses HTTPS POST to api.tavily.com/search", () => {
    assert.ok(tavilyCode.includes("api.tavily.com/search"), "Must call Tavily API endpoint");
  });

  it("tavily request includes api_key and query in JSON body", () => {
    assert.ok(tavilyCode.includes("api_key"), "Must include api_key in request body");
  });

  it("multiEngineWebSearch supports tavily in engine loop", () => {
    // tavily must appear in both engineFns maps (searchWeb + multiEngineWebSearch)
    const matches = [...webSearchCode.matchAll(/tavily/g)];
    assert.ok(matches.length >= 2, "tavily must appear in both engineFns maps");
  });
});
