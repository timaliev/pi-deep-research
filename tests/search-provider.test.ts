import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DuckDuckGoProvider, type FetchFn } from "../extension/search/duckduckgo.js";
import type { SearchResult } from "../extension/search/provider.js";

/** Realistic DuckDuckGo HTML results page fragment. */
const MOCK_DDG_HTML = `
<!DOCTYPE html>
<html>
<body>
<div class="results">
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.typescriptlang.org%2Fdocs%2Fhandbook%2Fenums.html">
      TypeScript: Handbook - Enums
    </a>
    <a class="result__snippet">
      TypeScript provides both numeric and string-based enums. Enums allow a developer to define a set of named constants.
    </a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frefactoring.guru%2Fdesign-patterns%2Fstate%2Ftypescript%2Fexample">
      State in TypeScript / Design Patterns - Refactoring.Guru
    </a>
    <a class="result__snippet">
      State is a behavioral design pattern that allows an object to change its behavior when its internal state changes. The pattern extracts state-related behaviors into separate classes.
    </a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.npmjs.com%2Fpackage%2Fxstate">
      xstate - npm
    </a>
    <a class="result__snippet">
      XState is a state management and orchestration solution for JavaScript and TypeScript apps. It uses finite state machines and statecharts.
    </a>
  </div>
</div>
</body>
</html>`;

function mockFetch(html: string): FetchFn {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
  };
}

describe("SearchProvider", () => {
  describe("DuckDuckGoProvider", () => {
    it("parses results from DDG HTML with correct shape", async () => {
      const provider = new DuckDuckGoProvider(mockFetch(MOCK_DDG_HTML));
      const results = await provider.search("typescript state machine", 3);

      assert.ok(Array.isArray(results), "results should be an array");
      assert.equal(results.length, 3, "should return all 3 results from mock HTML");

      for (const result of results) {
        assertSearchResultShape(result);
      }

      // Verify extracted content matches mock
      assert.ok(
        results[0].title.includes("TypeScript"),
        "first result title should be TypeScript-related"
      );
      assert.ok(
        results[1].url.includes("refactoring.guru"),
        "second result URL should be refactoring.guru"
      );
      assert.ok(
        results[2].snippet.includes("XState"),
        "third result snippet should mention XState"
      );
    });

    it("respects maxResults parameter", async () => {
      const provider = new DuckDuckGoProvider(mockFetch(MOCK_DDG_HTML));
      const results = await provider.search("test", 2);
      assert.equal(results.length, 2, "should limit to 2 results");
    });

    it("returns empty array when HTML has no results", async () => {
      const emptyHtml = "<html><body><div>No results found.</div></body></html>";
      const provider = new DuckDuckGoProvider(mockFetch(emptyHtml));
      const results = await provider.search("xyzkqlmntwvprsdfghj", 5);
      assert.equal(results.length, 0, "should return empty array for no matches");
    });

    it("decodes DDG redirect URLs (uddg param)", async () => {
      const provider = new DuckDuckGoProvider(mockFetch(MOCK_DDG_HTML));
      const results = await provider.search("test", 3);

      // First result URL should be decoded from the uddg redirect
      assert.ok(
        results[0].url.startsWith("https://"),
        "URL should be decoded, got: " + results[0].url
      );
      assert.ok(
        !results[0].url.includes("duckduckgo.com"),
        "URL should not contain duckduckgo.com redirect"
      );
    });

    it("throws on non-200 response", async () => {
      const errorFetch: FetchFn = async () =>
        new Response("Server Error", { status: 500 });
      const provider = new DuckDuckGoProvider(errorFetch);

      await assert.rejects(
        () => provider.search("test"),
        /DuckDuckGo search returned 500/,
        "should throw on server error"
      );
    });
  });
});

function assertSearchResultShape(result: SearchResult): void {
  assert.equal(typeof result.title, "string", "title must be string");
  assert.equal(typeof result.url, "string", "url must be string");
  assert.equal(typeof result.snippet, "string", "snippet must be string");
  assert.ok(result.title.length > 0, "title must not be empty");
  assert.ok(result.url.startsWith("http"), `url must start with http, got: ${result.url}`);
}
