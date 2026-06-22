import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TavilyProvider, type FetchFn } from "../extension/search/tavily.js";
import type { SearchResult } from "../extension/search/provider.js";

function mockFetch(json: unknown): FetchFn {
  return async (_input: RequestInfo | URL, init?: RequestInit) => {
    // Verify API key is sent in request body
    const body = init?.body ? JSON.parse(init.body as string) : {};
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const MOCK_TAVILY_RESPONSE = {
  query: "typescript state machine",
  results: [
    {
      title: "XState - JavaScript State Machines",
      url: "https://xstate.js.org/docs/",
      content: "XState is a state management and orchestration solution for JavaScript and TypeScript apps using finite state machines and statecharts.",
      score: 0.95,
      raw_content: null,
    },
    {
      title: "State Pattern in TypeScript",
      url: "https://refactoring.guru/design-patterns/state/typescript",
      content: "State is a behavioral design pattern that allows an object to change its behavior when its internal state changes. In TypeScript, this pattern is commonly implemented using classes and interfaces.",
      score: 0.87,
      raw_content: null,
    },
    {
      title: "Robot - Finite State Machines",
      url: "https://thisrobot.life/",
      content: "Robot is a lightweight functional finite state machine library for JavaScript and TypeScript. Simple API with composable state definitions.",
      score: 0.72,
      raw_content: null,
    },
  ],
  response_time: 1.24,
};

describe("SearchProvider", () => {
  describe("TavilyProvider", () => {
    it("returns search results with correct shape", async () => {
      const provider = new TavilyProvider("test-api-key", mockFetch(MOCK_TAVILY_RESPONSE));
      const results = await provider.search("typescript state machine", 5);

      assert.ok(Array.isArray(results), "results should be an array");
      assert.equal(results.length, 3, "should return all results from API");

      for (const result of results) {
        assertSearchResultShape(result);
      }

      // Verify content mapping
      assert.ok(results[0].title.includes("XState"));
      assert.equal(results[0].url, "https://xstate.js.org/docs/");
      assert.ok(results[0].snippet.includes("state management"));
    });

    it("respects maxResults parameter", async () => {
      const provider = new TavilyProvider("test-api-key", mockFetch(MOCK_TAVILY_RESPONSE));
      const results = await provider.search("test", 2);
      assert.equal(results.length, 2, "should limit to maxResults");
    });

    it("sends API key in request body", async () => {
      let capturedBody: Record<string, unknown> = {};

      const captureFetch: FetchFn = async (_input, init) => {
        capturedBody = init?.body ? JSON.parse(init.body as string) : {};
        return new Response(JSON.stringify(MOCK_TAVILY_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const provider = new TavilyProvider("my-secret-key", captureFetch);
      await provider.search("test");

      assert.equal(capturedBody.api_key, "my-secret-key", "API key should be in body");
      assert.equal(capturedBody.query, "test", "query should be in body");
    });

    it("handles Tavily API error response", async () => {
      const errorFetch: FetchFn = async () =>
        new Response(
          JSON.stringify({ error: "Invalid API key" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );

      const provider = new TavilyProvider("bad-key", errorFetch);
      await assert.rejects(
        () => provider.search("test"),
        /Tavily API error/,
        "should throw on API error"
      );
    });

    it("handles empty results", async () => {
      const emptyResponse = { query: "test", results: [], response_time: 0.1 };
      const provider = new TavilyProvider("key", mockFetch(emptyResponse));
      const results = await provider.search("test");
      assert.equal(results.length, 0, "should return empty array for no results");
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
