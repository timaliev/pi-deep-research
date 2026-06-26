import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrefilterManager } from "../extension/prefilter.js";
import { buildDraftingPrompt } from "../extension/state-machine.js";
import type { ResearchPlan, ResearchPlanProfile } from "../extension/prefilter.js";
import type { Finding } from "../extension/state-machine.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Scraper, ScrapedPage } from "../extension/scraper.js";

const TEST_ARTIFACTS = join(import.meta.dirname ?? ".", "..", "test-artifacts-style");

function mockSearchFn(results: WebSearchResult[]) {
  return async (_query: string, _max?: number) => results;
}

function mockScraper(pages: Map<string, ScrapedPage>): Scraper {
  return {
    async scrape(url: string) {
      const page = pages.get(url);
      if (!page) throw new Error(`No mock page for ${url}`);
      return page;
    },
  };
}

const MOCK_RESULTS: WebSearchResult[] = [
  { title: "Doc A", url: "https://a.com", snippet: "Info A.", engine: "duckduckgo" },
];

function mockScrapedPages(): Map<string, ScrapedPage> {
  const m = new Map<string, ScrapedPage>();
  m.set("https://a.com", { url: "https://a.com", title: "Doc A", content: "Content A..." });
  return m;
}

function validPlan(overrides?: Partial<ResearchPlan>): ResearchPlan {
  return {
    topic: "test",
    goal: "test goal",
    researchQuestions: ["q1"],
    engines: ["duckduckgo"],
    profile: { name: "default" },
    scope: { include: "a", exclude: "b" },
    estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
    ...overrides,
  } as ResearchPlan;
}

// ─── RED: reportStyle validation ──────────────────────────────────

describe("reportStyle in ResearchPlan validation", () => {
  beforeEach(() => { mkdirSync(TEST_ARTIFACTS, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_ARTIFACTS)) rmSync(TEST_ARTIFACTS, { recursive: true, force: true }); });

  it("rejects invalid reportStyle value", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    const planJson = JSON.stringify({
      ...validPlan(),
      reportStyle: "invalid_value",
    });

    const result = await manager.finalize("test", planJson);
    assert.equal(result.phase, "error");
    assert.ok(result.error!.includes("reportStyle"),
      `error must mention reportStyle, got: ${result.error}`);
  });

  it("accepts reportStyle: 'narrative'", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    const planJson = JSON.stringify({
      ...validPlan(),
      reportStyle: "narrative",
    });

    const result = await manager.finalize("test", planJson);
    assert.equal(result.phase, "plan_ready");
  });

  it("accepts reportStyle: 'subtopics'", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    const planJson = JSON.stringify({
      ...validPlan(),
      reportStyle: "subtopics",
    });

    const result = await manager.finalize("test", planJson);
    assert.equal(result.phase, "plan_ready");
  });

  it("accepts plan without reportStyle (backward compat)", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    const planJson = JSON.stringify(validPlan()); // no reportStyle

    const result = await manager.finalize("test", planJson);
    assert.equal(result.phase, "plan_ready");
  });
});

// ─── RED: buildDraftingPrompt dispatches on reportStyle ───────────

const MOCK_FINDINGS: Finding[] = [
  { text: "Finding one", sourceUrl: "https://a.com", citation: "...", iteration: 0 },
  { text: "Finding two", sourceUrl: "https://b.com", citation: "...", iteration: 1 },
];

describe("buildDraftingPrompt with reportStyle", () => {
  it("narrative style produces 5-section template (current behavior)", () => {
    const plan = validPlan({ reportStyle: "narrative" });
    const prompt = buildDraftingPrompt(plan, MOCK_FINDINGS);

    assert.ok(prompt.includes("Introduction"), "must include Introduction section");
    assert.ok(prompt.includes("Findings"), "must include Findings section");
    assert.ok(prompt.includes("Analysis"), "must include Analysis section");
    assert.ok(prompt.includes("Recommendations"), "must include Recommendations section");
    assert.ok(prompt.includes("Sources"), "must include Sources section");
  });

  it("subtopics style does NOT contain fixed 5-section template", () => {
    const plan = validPlan({ reportStyle: "subtopics" });
    const prompt = buildDraftingPrompt(plan, MOCK_FINDINGS);

    // Must NOT have the rigid 5-section numbered list
    assert.ok(!prompt.includes("1. **Introduction**"), "subtopics must not list numbered sections");
    assert.ok(!prompt.includes("5. **Sources**"), "subtopics must not list Sources as section 5");
    // But "Structure Guidance" in subtopics is fine — it's thematic, not rigid
  });

  it("subtopics style instructs LLM to generate thematic sections", () => {
    const plan = validPlan({ reportStyle: "subtopics" });
    const prompt = buildDraftingPrompt(plan, MOCK_FINDINGS);

    assert.ok(
      prompt.includes("thematic") || prompt.includes("subtopic") || prompt.includes("sections") ||
      prompt.includes("themes") || prompt.includes("topics") || prompt.includes("discover"),
      "subtopics prompt must instruct LLM to generate thematic sections"
    );
  });

  it("subtopics style includes findings in the prompt", () => {
    const plan = validPlan({ reportStyle: "subtopics" });
    const prompt = buildDraftingPrompt(plan, MOCK_FINDINGS);

    assert.ok(prompt.includes("Finding one"), "must include finding text");
    assert.ok(prompt.includes("https://a.com"), "must include finding source");
  });

  it("missing reportStyle falls back to narrative (backward compat)", () => {
    const plan = validPlan(); // no reportStyle
    const prompt = buildDraftingPrompt(plan, MOCK_FINDINGS);

    assert.ok(prompt.includes("Introduction"), "must default to narrative");
    assert.ok(prompt.includes("Recommendations"), "must default to narrative");
  });
});

// ─── RED: prefilter prompts mention reportStyle ───────────────────

describe("prefilter prompts mention reportStyle", () => {
  beforeEach(() => { mkdirSync(TEST_ARTIFACTS, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_ARTIFACTS)) rmSync(TEST_ARTIFACTS, { recursive: true, force: true }); });

  it("buildParamsPrompt mentions reportStyle choice", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
    const result = await manager.start("test");

    assert.ok(result.inject!.includes("reportStyle") || result.inject!.includes("report style") ||
      result.inject!.includes("report format") || result.inject!.includes("report_format"),
      "params prompt must mention reportStyle choice");
  });

  it("buildPlanPrompt includes reportStyle in JSON template", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
    const result = await manager.withParams("test", ["duckduckgo"], { name: "fast" });

    assert.ok(result.inject!.includes("reportStyle") || result.inject!.includes("report_style"),
      "plan prompt JSON template must include reportStyle field");
  });
});
