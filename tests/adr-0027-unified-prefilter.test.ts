/**
 * ADR-0027: Single-call plan_research state machine.
 * Tests for unified PrefilterManager.next() replacing multi-call protocol.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { WebSearchResult } from "../extension/search/web-search.js";

const MOCK_RESULTS: WebSearchResult[] = [
  { title: "Test", url: "https://example.com", snippet: "test", engine: "duckduckgo" },
];

function mockSearchFn(results = MOCK_RESULTS) {
  return async () => results;
}
function mockScraper() {
  return { scrape: async () => ({ url: "", title: "", content: "" }) };
}

describe("ADR-0027 — Unified PrefilterManager.next()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pi-test-unified-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("step 1: topic call returns engine/profile selection prompt", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    const result = await manager.next({ type: "topic", topic: "test" });
    assert.equal(result.phase, "awaiting_params");
    assert.ok(result.inject!.includes("engines"), "must ask for engines");
    assert.ok(result.inject!.includes("profile"), "must ask for profile");
  });

  it("step 2: after topic, sending params triggers preliminary search and returns plan prompt", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    await manager.next({ type: "topic", topic: "test" });
    const result = await manager.next({ type: "params", engines: ["duckduckgo"], profile: { name: "default" } });

    assert.equal(result.phase, "awaiting_plan");
    assert.ok(result.inject!.includes("Research Planning"), "must ask for plan");
  });

  it("step 3: after params, zero-param call triggers introspection", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    await manager.next({ type: "topic", topic: "test" });
    await manager.next({ type: "params", engines: ["duckduckgo"], profile: { name: "default" } });
    const result = await manager.next({ type: "continue" });

    assert.equal(result.phase, "awaiting_plan");
    assert.ok(result.inject!.includes("LLM Knowledge"), "must ask for LLM introspection");
  });

  it("step 4: second continue triggers merge search", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    await manager.next({ type: "topic", topic: "test" });
    await manager.next({ type: "params", engines: ["duckduckgo"], profile: { name: "default" } });
    await manager.next({ type: "continue" });
    const result = await manager.next({ type: "continue", llmResponse: "some topics" });

    assert.equal(result.phase, "awaiting_plan");
    assert.ok(result.inject!.includes("Merge"), "must ask to merge and produce plan");
  });

  it("rejects plan submission when continue() was skipped", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    await manager.next({ type: "topic", topic: "test" });
    await manager.next({ type: "params", engines: ["duckduckgo"], profile: { name: "default" } });
    const plan = JSON.stringify({
      topic: "test",
      goal: "g",
      researchQuestions: ["q1"],
      engines: ["duckduckgo"],
      profile: { name: "default" },
      scope: { include: "", exclude: "" },
      estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "1" },
    });
    const result = await manager.next({ type: "plan", planJson: plan });
    assert.equal(result.phase, "error", "must reject when continue skipped");
    assert.ok(result.error!.includes("introspection"), "error must mention introspection");
  });

  it("full pipeline: topic → params → introspect → merge → plan → plan_ready", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    await manager.next({ type: "topic", topic: "test" });
    await manager.next({ type: "params", engines: ["duckduckgo"], profile: { name: "default" } });
    await manager.next({ type: "continue" });
    await manager.next({ type: "continue", llmResponse: "some topics" });

    const plan = JSON.stringify({
      topic: "test",
      goal: "g",
      researchQuestions: ["q1"],
      engines: ["duckduckgo"],
      profile: { name: "default" },
      scope: { include: "", exclude: "" },
      estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "1" },
    });
    const result = await manager.next({ type: "plan", planJson: plan });

    assert.equal(result.phase, "plan_ready");
    assert.ok(result.planArtifactPath, "must have artifact path");
  });

  // ─── getPhase() — expose internal phase for tool state tracking ─────────

  it("getPhase returns awaiting_params for fresh manager", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    assert.equal(manager.getPhase(), "awaiting_params", "fresh manager starts in awaiting_params");
  });

  it("getPhase returns awaiting_params after topic call", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    await manager.next({ type: "topic", topic: "test" });
    assert.equal(manager.getPhase(), "awaiting_params");
  });

  it("getPhase returns introspecting after continue call", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    await manager.next({ type: "topic", topic: "test" });
    await manager.next({ type: "params", engines: ["duckduckgo"], profile: { name: "default" } });
    await manager.next({ type: "continue" });
    assert.equal(manager.getPhase(), "introspecting");
  });

  it("getPhase returns merging after second continue with llmResponse", async () => {
    const { PrefilterManager } = await import("../extension/prefilter.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");

    const manager = new PrefilterManager({
      searchFn: mockSearchFn(),
      scraper: mockScraper(),
      artifactsDir: tmpDir,
      profileResolver: new ProfileResolver({}),
    });

    await manager.next({ type: "topic", topic: "test" });
    await manager.next({ type: "params", engines: ["duckduckgo"], profile: { name: "default" } });
    await manager.next({ type: "continue" });
    await manager.next({ type: "continue", llmResponse: "some topics" });
    assert.equal(manager.getPhase(), "merging");
  });
});
