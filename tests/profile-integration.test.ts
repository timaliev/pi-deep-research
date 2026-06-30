import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDeepResearchSettings } from "../extension/profile-resolver.js";
import { ProfileResolver } from "../extension/profile-resolver.js";
import { PrefilterManager } from "../extension/prefilter.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-settings-merge-int");
const TEST_HOME = join(TEST_DIR, "home", ".pi", "agent");
const TEST_CWD = join(TEST_DIR, "project");

function mockSearchFn(results: WebSearchResult[]) {
  return async () => results;
}
function mockScraper(pages: Map<string, ScrapedPage>): Scraper {
  return {
    async scrape(url: string) {
      const page = pages.get(url);
      if (!page) throw new Error(`No mock: ${url}`);
      return page;
    },
  };
}
const MOCK_RESULTS: WebSearchResult[] = [
  { title: "A", url: "https://a.com", snippet: "...", engine: "duckduckgo" },
];
const MOCK_PAGES = new Map<string, ScrapedPage>();
MOCK_PAGES.set("https://a.com", { url: "https://a.com", title: "A", content: "..." });

// ─── Slice 1: loadDeepResearchSettings merge ─────────────────────

describe("loadDeepResearchSettings global + local merge", () => {
  beforeEach(() => { mkdirSync(TEST_HOME, { recursive: true }); mkdirSync(TEST_CWD, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("merges global and local, local wins on conflict", () => {
    mkdirSync(join(TEST_CWD, ".pi"), { recursive: true });
    writeFileSync(join(TEST_HOME, "settings.json"), JSON.stringify({
      deepResearch: {
        profiles: { deep: { breadth: 8 } },
        defaultProfile: "deep",
      },
    }), "utf-8");

    writeFileSync(join(TEST_CWD, ".pi", "settings.json"), JSON.stringify({
      deepResearch: {
        profiles: { deep: { breadth: 10, depth: 5 }, exhaustive: { breadth: 12 } },
        defaultProfile: "exhaustive",
      },
    }), "utf-8");

    const settings = loadDeepResearchSettings(TEST_CWD, TEST_HOME);

    assert.equal(settings.defaultProfile, "exhaustive", "local defaultProfile wins");

    const resolver = new ProfileResolver(settings.profiles ?? {}, settings.defaultProfile);
    const deep = resolver.resolve({ name: "deep" });

    assert.equal(deep.breadth, 10, "local deep.breadth=10 overrides global=8");
    assert.equal(deep.depth, 5, "local deep.depth=5 added");
    assert.equal(deep.concurrency, 4, "concurrency from built-in default (neither specified)");

    const exhaustive = resolver.resolve({ name: "exhaustive" });
    assert.equal(exhaustive.breadth, 12, "local-only profile");
    assert.equal(exhaustive.depth, 2, "fills built-in default");
  });

  it("global only — no local file", () => {
    writeFileSync(join(TEST_HOME, "settings.json"), JSON.stringify({
      deepResearch: {
        profiles: { deep: { breadth: 7 } },
      },
    }), "utf-8");

    const settings = loadDeepResearchSettings(join(TEST_DIR, "no-project"), TEST_HOME);

    const resolver = new ProfileResolver(settings.profiles ?? {}, settings.defaultProfile);
    assert.equal(resolver.resolve({ name: "deep" }).breadth, 7);
    assert.equal(resolver.resolve({ name: "default" }).breadth, 4, "built-in untouched");
  });
});

// ─── Slice 2: buildParamsPrompt lists merged profiles ────────────

describe("buildParamsPrompt with ProfileResolver", () => {
  beforeEach(() => { mkdirSync(TEST_CWD, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("lists user-added profile names in prompt", async () => {
    const resolver = new ProfileResolver(
      { exhaustive: { breadth: 10, depth: 5, concurrency: 8 } },
      "default",
    );

    const manager = new PrefilterManager(
      mockSearchFn(MOCK_RESULTS), mockScraper(MOCK_PAGES), TEST_CWD, undefined, resolver,
    );

    const result = await manager.start("test");

    assert.ok(result.inject!.includes("exhaustive"), "must list user-added profile");
    assert.ok(result.inject!.includes("breadth=10"), "must show exhaustive.breadth");
    assert.ok(result.inject!.includes("default: **default**"), "must highlight default profile");
  });

  it("highlights custom defaultProfile in prompt", async () => {
    const resolver = new ProfileResolver({}, "deep");

    const manager = new PrefilterManager(
      mockSearchFn(MOCK_RESULTS), mockScraper(MOCK_PAGES), TEST_CWD, undefined, resolver,
    );

    const result = await manager.start("test");

    assert.ok(result.inject!.includes("default: **deep**"), "must highlight deep as default");
  });
});

// ─── Slice 3: buildPlanPrompt resolves via ProfileResolver ───────

describe("buildPlanPrompt with ProfileResolver", () => {
  beforeEach(() => { mkdirSync(TEST_CWD, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("shows resolved breadth/depth/concurrency from merged profile", async () => {
    const resolver = new ProfileResolver(
      { deep: { breadth: 8, depth: 4 } },
      "default",
    );

    const manager = new PrefilterManager(
      mockSearchFn(MOCK_RESULTS), mockScraper(MOCK_PAGES), TEST_CWD, undefined, resolver,
    );

    const result = await manager.withParams("test", ["duckduckgo"], { name: "deep" });

    assert.ok(result.inject!.includes("breadth=8"), "must show resolved breadth=8");
    assert.ok(result.inject!.includes("depth=4"), "must show resolved depth=4");
    assert.ok(result.inject!.includes("concurrency=4"), "must show built-in concurrency");
  });

  it("lists merged profile names in plan prompt", async () => {
    const resolver = new ProfileResolver(
      { exhaustive: { breadth: 10, depth: 5, concurrency: 8 } },
      "default",
    );

    const manager = new PrefilterManager(
      mockSearchFn(MOCK_RESULTS), mockScraper(MOCK_PAGES), TEST_CWD, undefined, resolver,
    );

    const result = await manager.withParams("test", ["duckduckgo"], { name: "default" });

    assert.ok(result.inject!.includes("exhaustive"), "must list exhaustive in available presets");
  });
});
