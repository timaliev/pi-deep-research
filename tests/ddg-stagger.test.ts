/**
 * Test that RateLimiter owns stagger/backoff logic
 * and adapters use rateLimiter instead of deprecated engineLastCall/waitIfNeeded.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const RL_CODE_PATH = join(import.meta.dirname ?? ".", "..", "extension", "search", "rate-limiter.ts");
const DDG_CODE_PATH = join(import.meta.dirname ?? ".", "..", "extension", "search", "engines", "duckduckgo.ts");
const BRAVE_CODE_PATH = join(import.meta.dirname ?? ".", "..", "extension", "search", "engines", "brave.ts");

const rlCode = readFileSync(RL_CODE_PATH, "utf-8");
const ddgCode = readFileSync(DDG_CODE_PATH, "utf-8");
const braveCode = readFileSync(BRAVE_CODE_PATH, "utf-8");

describe("RateLimiter config", () => {
  it("DDG min delay >= 2000ms in default configs", () => {
    const match = rlCode.match(/duckduckgo[\s\S]*?minDelayMs:\s*(\d+)/);
    assert.ok(match, "DDG minDelayMs must exist in DEFAULT_RATE_LIMIT_CONFIGS");
    assert.ok(Number(match[1]) >= 2000, `DDG min delay must be >= 2000ms, got ${match[1]}`);
  });

  it("DDG has preStaggerMs configured", () => {
    const match = rlCode.match(/duckduckgo[\s\S]*?preStaggerMs:\s*(\d+)/);
    assert.ok(match, "DDG must have preStaggerMs in config");
    assert.ok(Number(match[1]) >= 1000, `preStaggerMs must be >= 1000ms, got ${match[1]}`);
  });

  it("DDG has retry config with backoff multiplier", () => {
    assert.ok(rlCode.includes("maxRetries:"), "DDG retry config must include maxRetries");
    assert.ok(rlCode.includes("backoffMultiplier:"), "DDG retry config must include backoffMultiplier");
  });

  it("all 5 engines have configs in DEFAULT_RATE_LIMIT_CONFIGS", () => {
    for (const engine of ["duckduckgo", "brave", "tavily", "yandex", "searxng"]) {
      assert.ok(rlCode.includes(`${engine}:`), `${engine} must be in DEFAULT_RATE_LIMIT_CONFIGS`);
    }
  });
});

describe("Adapter rate-limit usage", () => {
  it("DDG adapter search() uses rateLimiter.waitIfNeeded + rateLimiter.retryOnRateLimit + rateLimiter.recordCall", () => {
    const fnMatch = ddgCode.match(/export async function search\([\s\S]*?^}/m);
    assert.ok(fnMatch, "search function must exist in duckduckgo.ts");
    const body = fnMatch[0];

    assert.ok(body.includes("rateLimiter.waitIfNeeded"), "search() must call rateLimiter.waitIfNeeded");
    assert.ok(body.includes("rateLimiter.retryOnRateLimit"), "search() must call rateLimiter.retryOnRateLimit");
    assert.ok(body.includes("rateLimiter.recordCall"), "search() must call rateLimiter.recordCall");

    // waitIfNeeded must be called before rateLimiter.retryOnRateLimit
    const waitPos = body.indexOf("rateLimiter.waitIfNeeded");
    const retryPos = body.indexOf("rateLimiter.retryOnRateLimit");
    const recordPos = body.indexOf("rateLimiter.recordCall");
    assert.ok(waitPos < retryPos, "waitIfNeeded must be BEFORE retryOnRateLimit");
    assert.ok(retryPos < recordPos, "retryOnRateLimit must be BEFORE recordCall");
  });

  it("DDG adapter no longer imports engineLastCall or waitIfNeeded", () => {
    assert.ok(!ddgCode.includes("engineLastCall"), "DDG adapter must not use engineLastCall");
    // waitIfNeeded might appear as part of rateLimiter.waitIfNeeded — check standalone import
    assert.ok(!ddgCode.includes("import { waitIfNeeded }"), "DDG adapter must not import waitIfNeeded directly");
  });

  it("searchDuckDuckGo throws RateLimitError when rate-limited", () => {
    const fnMatch = ddgCode.match(/export async function searchDuckDuckGo[\s\S]*?^}/m);
    assert.ok(fnMatch, "searchDuckDuckGo must exist");
    const body = fnMatch[0];
    assert.ok(body.includes("RateLimitError"), "searchDuckDuckGo must throw RateLimitError when rate-limited");
  });

  it("brave adapter search() calls rateLimiter.waitIfNeeded and rateLimiter.recordCall", () => {
    const fnMatch = braveCode.match(/export async function search\([\s\S]*?^}/m);
    assert.ok(fnMatch, "search function must exist in brave.ts");
    const body = fnMatch[0];

    assert.ok(body.includes("rateLimiter.waitIfNeeded"), "brave search() must call rateLimiter.waitIfNeeded");
    assert.ok(body.includes("rateLimiter.recordCall"), "brave search() must call rateLimiter.recordCall");

    const waitPos = body.indexOf("rateLimiter.waitIfNeeded");
    const httpPos = body.search(/searchBrave\(/);
    const recordPos = body.indexOf("rateLimiter.recordCall");
    assert.ok(waitPos < httpPos, "waitIfNeeded must be BEFORE searchBrave HTTP call");
    assert.ok(httpPos < recordPos, "recordCall must be AFTER searchBrave HTTP call");
  });
});
