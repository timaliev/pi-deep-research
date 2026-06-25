/**
 * Test that DDG searches are staggered with random pre-delay
 * to avoid simultaneous requests that trigger rate limiting.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SEARCH_CODE_PATH = join(import.meta.dirname ?? ".", "..", "extension", "search", "web-search.ts");
const searchCode = readFileSync(SEARCH_CODE_PATH, "utf-8");

describe("DDG search stagger", () => {
  it("engineLastCall is updated BEFORE HTTP request, not after", () => {
    // Find searchDuckDuckGo function body
    const fnMatch = searchCode.match(/async function searchDuckDuckGo[\s\S]*?^}/m);
    assert.ok(fnMatch, "searchDuckDuckGo function must exist");
    const fnBody = fnMatch[0];

    // Find all occurrences of engineLastCall["duckduckgo"] or engineLastCall["duckduckgo"] =
    const lastCallUpdates = [...fnBody.matchAll(/engineLastCall\[["']duckduckgo["']\]\s*=\s*Date\.now\(\)/g)];
    
    // Must have at least one update
    assert.ok(lastCallUpdates.length >= 1, "engineLastCall must be updated for duckduckgo");
    
    // The first update must happen BEFORE the postForm/fetchUrl HTTP call
    const firstUpdatePos = lastCallUpdates[0].index!;
    const httpCallPos = fnBody.search(/postForm\(|fetchUrl\(/);
    
    assert.ok(
      firstUpdatePos < httpCallPos,
      `engineLastCall update (pos ${firstUpdatePos}) must be BEFORE HTTP call (pos ${httpCallPos})`
    );
  });

  it("searchDuckDuckGo has pre-request random delay", () => {
    // searchDuckDuckGo must have a random pre-delay before the HTTP request
    // to stagger concurrent requests
    const fnMatch = searchCode.match(/async function searchDuckDuckGo[\s\S]*?^}/m);
    assert.ok(fnMatch, "searchDuckDuckGo function must exist");
    const fnBody = fnMatch[0];
    
    // Find the retry loop and check what happens before first HTTP call
    // Should have Math.random() used for pre-delay, not just backoff
    const hasPreDelayRandom = fnBody.includes("Math.random()");
    assert.ok(hasPreDelayRandom, "Must use Math.random() for delay jitter");
  });

  it("DDG min delay between requests is >= 2000ms", () => {
    const match = searchCode.match(/duckduckgo["']?\s*:\s*(\d+)/);
    assert.ok(match, "Must have DDG min delay configured");
    assert.ok(
      Number(match[1]) >= 2000,
      `DDG min delay must be >= 2000ms to avoid rate limits, got ${match[1]}`
    );
  });

  it("waitIfNeeded is called BEFORE the HTTP request in searchWeb loop", () => {
    // In searchWeb's engine loop, waitIfNeeded must be called before the HTTP call
    const searchWebMatch = searchCode.match(/export async function searchWeb[\s\S]*?^export/m);
    assert.ok(searchWebMatch, "searchWeb function must exist");
    const fnBody = searchWebMatch[0];
    
    const waitPos = fnBody.search(/await waitIfNeeded/);
    const fnCallPos = fnBody.search(/const results = await fn\(/);
    
    assert.ok(waitPos >= 0, "waitIfNeeded must be in searchWeb");
    assert.ok(fnCallPos >= 0, "engine fn call must be in searchWeb");
    assert.ok(
      waitPos < fnCallPos,
      `waitIfNeeded (pos ${waitPos}) must be BEFORE engine call (pos ${fnCallPos})`
    );
  });
});
