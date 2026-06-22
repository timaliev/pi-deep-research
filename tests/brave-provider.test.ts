import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BraveProvider, type FetchFn } from "../extension/search/brave.js";
import type { SearchResult } from "../extension/search/provider.js";

function mockFetch(json: unknown): FetchFn {
  return async (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const MOCK_BRAVE_RESPONSE = {
  web: {
    type: "search",
    results: [
      {
        title: "XState - JavaScript State Machines & Statecharts",
        url: "https://xstate.js.org/docs/",
        description: "XState is a state management and orchestration solution for JavaScript and TypeScript apps using finite state machines and statecharts. Hierarchical, parallel, and history states.",
        age: "2024-03-15",
        language: "en",
      },
      {
        title: "State Pattern in TypeScript — Refactoring.Guru",
        url: "https://refactoring.guru/design-patterns/state/typescript",
        description: "State is a behavioral design pattern that lets an object alter its behavior when its internal state changes. Appears as if the object changed its class.",
        age: "2024-01-20",
        language: "en",
      },
      {
        title: "Robot — Finite State Machines for Functional Programming",
        url: "https://thisrobot.life/",
        description: "Robot is a lightweight functional state machine library. Composable, immutable state definitions with a simple API.",
        age: "2024-02-10",
        language: "en",
      },
    ],
    family_friendly: true,
  },
};

describe("SearchProvider", () => {
  describe("BraveProvider", () => {
    it("returns search results with correct shape", async () => {
      const provider = new BraveProvider("test-api-key", mockFetch(MOCK_BRAVE_RESPONSE));
      const results = await provider.search("typescript state machine", 5);

      assert.ok(Array.isArray(results));
      assert.equal(results.length, 3, "should return all 3 results");

      for (const r of results) {
        assertSearchResultShape(r);
      }

      assert.ok(results[0].title.includes("XState"));
      assert.ok(results[0].url.startsWith("https://"));
      assert.ok(results[0].snippet.includes("orchestration"));
    });

    it("respects maxResults parameter", async () => {
      const provider = new BraveProvider("key", mockFetch(MOCK_BRAVE_RESPONSE));
      const results = await provider.search("test", 2);
      assert.equal(results.length, 2);
    });

    it("sends API key in Authorization header", async () => {
      let capturedHeaders: Record<string, string> = {};

      const captureFetch: FetchFn = async (_input, init) => {
        const h = init?.headers as Record<string, string> | undefined;
        if (h) {
          capturedHeaders = { ...h };
        }
        return new Response(JSON.stringify(MOCK_BRAVE_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const provider = new BraveProvider("my-brave-key", captureFetch);
      await provider.search("test");

      assert.ok(
        capturedHeaders["Authorization"]?.includes("my-brave-key") ||
        capturedHeaders["X-Subscription-Token"] === "my-brave-key",
        "API key should be sent in header"
      );
    });

    it("handles error response", async () => {
      const errorFetch: FetchFn = async () =>
        new Response(
          JSON.stringify({ error: { detail: "Invalid subscription token" } }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );

      const provider = new BraveProvider("bad-key", errorFetch);
      await assert.rejects(
        () => provider.search("test"),
        /Brave Search API error/,
        "should throw on API error"
      );
    });

    it("handles empty results", async () => {
      const empty = { web: { type: "search", results: [], family_friendly: true } };
      const provider = new BraveProvider("key", mockFetch(empty));
      const results = await provider.search("nonexistent");
      assert.equal(results.length, 0);
    });
  });
});

function assertSearchResultShape(result: SearchResult): void {
  assert.equal(typeof result.title, "string");
  assert.equal(typeof result.url, "string");
  assert.equal(typeof result.snippet, "string");
  assert.ok(result.title.length > 0);
  assert.ok(result.url.startsWith("http"));
}
