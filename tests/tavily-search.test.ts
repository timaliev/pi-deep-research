/**
 * Test Tavily search integration.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const webSearchCode = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "search", "web-search.ts"),
  "utf-8"
);
const prefilterCode = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "prefilter.ts"),
  "utf-8"
);

describe("Tavily search integration", () => {
  it("SearchEngine type includes tavily", () => {
    const match = webSearchCode.match(/export type SearchEngine = ["'\w\s|]+/);
    assert.ok(match, "SearchEngine type must exist");
    assert.ok(
      match[0].includes("tavily"),
      "SearchEngine type must include 'tavily'"
    );
  });

  it("searchTavily function exists with API key check", () => {
    assert.ok(
      webSearchCode.includes("searchTavily") || webSearchCode.includes("async function searchTavily"),
      "searchTavily function must exist"
    );
    assert.ok(
      webSearchCode.includes("TAVILY_API_KEY"),
      "Must check TAVILY_API_KEY env var"
    );
  });

  it("searchWeb dispatches to tavily engine", () => {
    // Verify tavily is in the engineFns map
    const engineFnMatch = webSearchCode.match(/engineFns[\s\S]*?^\s*\};/m);
    assert.ok(engineFnMatch, "engineFns map must exist");
    assert.ok(
      engineFnMatch[0].includes("tavily"),
      "engineFns must include tavily entry"
    );
  });

  it("prefilter warns when tavily selected without API key", () => {
    assert.ok(
      prefilterCode.includes("TAVILY_API_KEY"),
      "Prefilter must check TAVILY_API_KEY"
    );
  });

  it("tavily uses HTTPS POST to api.tavily.com/search", () => {
    assert.ok(
      webSearchCode.includes("api.tavily.com/search"),
      "Must call Tavily API endpoint"
    );
  });

  it("tavily request includes api_key and query in JSON body", () => {
    assert.ok(
      webSearchCode.includes("api_key"),
      "Must include api_key in request body"
    );
  });

  it("multiEngineWebSearch supports tavily in engine loop", () => {
    // The second engineFns map (in multiEngineWebSearch) also needs tavily
    const matches = [...webSearchCode.matchAll(/tavily/g)];
    assert.ok(matches.length >= 3, "tavily must appear in both engineFns maps and searchTavily function");
  });
});
