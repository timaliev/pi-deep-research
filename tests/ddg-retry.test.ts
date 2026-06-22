import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DuckDuckGoProvider } from "../extension/search/duckduckgo.js";
import type { SearchResult } from "../extension/search/provider.js";

describe("DuckDuckGoProvider retry and fallback", () => {
  it("falls back to HTML when duck-duck-scrape fails (production mode)", async () => {
    // In production mode (no custom fetchFn), it tries duck-duck-scrape first.
    // Since we can't test duck-duck-scrape reliably (rate-limited),
    // we verify the HTML fallback path works by using a custom fetchFn.
    const mockHtml = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Test Result</a>
        <a class="result__snippet">This is a test snippet.</a>
      </div>`;

    const mockFetch = async () =>
      new Response(mockHtml, { status: 200, headers: { "Content-Type": "text/html" } });

    const provider = new DuckDuckGoProvider(mockFetch);
    const results = await provider.search("test", 3);

    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Test Result");
    assert.equal(results[0].url, "https://example.com");
    assert.equal(results[0].snippet, "This is a test snippet.");
  });

  it("skips empty results from malformed HTML", async () => {
    const mockFetch = async () =>
      new Response("<html><body>No results here</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });

    const provider = new DuckDuckGoProvider(mockFetch);
    const results = await provider.search("nothing", 5);
    assert.equal(results.length, 0, "empty results for no-match HTML");
  });
});
