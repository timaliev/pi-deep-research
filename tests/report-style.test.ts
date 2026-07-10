import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ResearchPlan, ResearchPlanProfile } from "../extension/prefilter.js";
import { PrefilterManager } from "../extension/prefilter.js";
import { createReportStyle } from "../extension/report-styles.js";
import type { ScrapedPage, Scraper } from "../extension/scraper.js";
import type { WebSearchResult } from "../extension/search/web-search.js";
import type { Finding } from "../extension/state-machine.js";

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
  beforeEach(() => {
    mkdirSync(TEST_ARTIFACTS, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(TEST_ARTIFACTS)) rmSync(TEST_ARTIFACTS, { recursive: true, force: true });
  });

  it("rejects invalid reportStyle value", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);

    const planJson = JSON.stringify({
      ...validPlan(),
      reportStyle: "invalid_value",
    });

    const result = await manager.finalize("test", planJson);
    assert.equal(result.phase, "error");
    assert.ok(result.error!.includes("reportStyle"), `error must mention reportStyle, got: ${result.error}`);
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
    const prompt = createReportStyle(plan.reportStyle ?? "narrative").buildDraftingPrompt(plan, MOCK_FINDINGS);

    assert.ok(prompt.includes("Introduction"), "must include Introduction section");
    assert.ok(prompt.includes("Findings"), "must include Findings section");
    assert.ok(prompt.includes("Analysis"), "must include Analysis section");
    assert.ok(prompt.includes("Recommendations"), "must include Recommendations section");
    assert.ok(prompt.includes("Sources"), "must include Sources section");
  });

  it("subtopics style does NOT contain fixed 5-section template", () => {
    const plan = validPlan({ reportStyle: "subtopics" });
    const prompt = createReportStyle(plan.reportStyle ?? "narrative").buildDraftingPrompt(plan, MOCK_FINDINGS);

    // Must NOT have the rigid 5-section numbered list
    assert.ok(!prompt.includes("1. **Introduction**"), "subtopics must not list numbered sections");
    assert.ok(!prompt.includes("5. **Sources**"), "subtopics must not list Sources as section 5");
    // But "Structure Guidance" in subtopics is fine — it's thematic, not rigid
  });

  it("subtopics style instructs LLM to generate thematic sections", () => {
    const plan = validPlan({ reportStyle: "subtopics" });
    const prompt = createReportStyle(plan.reportStyle ?? "narrative").buildDraftingPrompt(plan, MOCK_FINDINGS);

    assert.ok(
      prompt.includes("thematic") ||
        prompt.includes("subtopic") ||
        prompt.includes("sections") ||
        prompt.includes("themes") ||
        prompt.includes("topics") ||
        prompt.includes("discover"),
      "subtopics prompt must instruct LLM to generate thematic sections",
    );
  });

  it("subtopics style includes findings in the prompt", () => {
    const plan = validPlan({ reportStyle: "subtopics" });
    const prompt = createReportStyle(plan.reportStyle ?? "narrative").buildDraftingPrompt(plan, MOCK_FINDINGS);

    assert.ok(prompt.includes("Finding one"), "must include finding text");
    assert.ok(prompt.includes("https://a.com"), "must include finding source");
  });

  it("missing reportStyle falls back to narrative (backward compat)", () => {
    const plan = validPlan(); // no reportStyle
    const prompt = createReportStyle("narrative").buildDraftingPrompt(plan, MOCK_FINDINGS);

    assert.ok(prompt.includes("Introduction"), "must default to narrative");
    assert.ok(prompt.includes("Recommendations"), "must default to narrative");
  });

  it("caps findings at 20 to prevent unbounded prompt growth", () => {
    // Create 35 findings — exceeding the 20 cap
    const manyFindings: Finding[] = [];
    for (let i = 0; i < 35; i++) {
      manyFindings.push({
        text: `Finding number ${i + 1} with some additional descriptive text to simulate real content`,
        sourceUrl: `https://source-${i + 1}.com`,
        citation: `...`,
        iteration: Math.floor(i / 10),
      });
    }

    const plan = validPlan({ reportStyle: "narrative" });
    const prompt = createReportStyle("narrative").buildDraftingPrompt(plan, manyFindings);

    // Must NOT contain ALL 35 findings (use exact pattern to avoid substring false positives)
    assert.ok(!prompt.includes("Finding number 1 with"), "first finding should be capped out");
    assert.ok(!prompt.includes("Finding number 5 with"), "early finding should be capped out");

    // Must contain recent findings (last 20)
    assert.ok(prompt.includes("Finding number 35"), "last finding must be present");
    assert.ok(prompt.includes("Finding number 16"), "finding at cap boundary must be present");

    // Must NOT exceed reasonable size (20 findings × 200 chars + structure overhead ≈ 5000)
    const promptLength = prompt.length;
    assert.ok(promptLength <= 5500, `prompt too long: ${promptLength} chars (max 5500)`);
  });

  it("subtopics style also caps findings", () => {
    const manyFindings: Finding[] = [];
    for (let i = 0; i < 40; i++) {
      manyFindings.push({
        text: `Subtopic finding ${i + 1}`,
        sourceUrl: `https://s-${i + 1}.com`,
        citation: `...`,
        iteration: Math.floor(i / 10),
      });
    }

    const plan = validPlan({ reportStyle: "subtopics" });
    const prompt = createReportStyle("subtopics").buildDraftingPrompt(plan, manyFindings);

    assert.ok(!prompt.includes("Subtopic finding 1\n"), "first finding should be capped");
    assert.ok(prompt.includes("Subtopic finding 40"), "last finding must be present");
    assert.ok(prompt.length <= 5500, `prompt too long: ${prompt.length} chars`);
  });
});

// ─── RED: prefilter prompts mention reportStyle ───────────────────

describe("prefilter prompts mention reportStyle", () => {
  beforeEach(() => {
    mkdirSync(TEST_ARTIFACTS, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(TEST_ARTIFACTS)) rmSync(TEST_ARTIFACTS, { recursive: true, force: true });
  });

  it("buildParamsPrompt mentions reportStyle choice", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
    const result = await manager.start("test");

    assert.ok(
      result.inject!.includes("reportStyle") ||
        result.inject!.includes("report style") ||
        result.inject!.includes("report format") ||
        result.inject!.includes("report_format"),
      "params prompt must mention reportStyle choice",
    );
  });

  it("buildPlanPrompt includes reportStyle in JSON template", async () => {
    const manager = new PrefilterManager(mockSearchFn(MOCK_RESULTS), mockScraper(mockScrapedPages()), TEST_ARTIFACTS);
    const result = await manager.withParams("test", ["duckduckgo"], { name: "fast" });

    assert.ok(
      result.inject!.includes("reportStyle") || result.inject!.includes("report_style"),
      "plan prompt JSON template must include reportStyle field",
    );
  });

  it("buildParamsPrompt shows (default) next to configured report style", async () => {
    const resolver = new (await import("../extension/profile-resolver.js")).ProfileResolver({});
    const manager = new PrefilterManager(
      mockSearchFn(MOCK_RESULTS),
      mockScraper(mockScrapedPages()),
      TEST_ARTIFACTS,
      undefined,
      resolver,
    );
    const result = await manager.start("test");

    // Prompt must have "narrative (default)" to mark the default report style
    // Not just "narrative" which always appears in the styles list
    assert.ok(
      result.inject!.includes("narrative (default)"),
      "params prompt must mark default report style with '(default)'",
    );
  });
});

// ─── ADR-0022: Done phase must NOT inject steer messages ─────
describe("run_research done phase — no steer messages", () => {
  it("done phase does NOT call sendUserMessage for PDF fallback", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "run-research.ts"), "utf-8");
    // Find the done-phase handler block
    const doneBlock = src.match(/if \(result\.kind === "done"\)[\s\S]*?^\s+return \{/m);
    assert.ok(doneBlock, "done phase block must exist");
    // Must NOT call sendUserMessage inside done block
    assert.ok(!doneBlock[0].includes("sendUserMessage"), "done phase must not call sendUserMessage");
  });

  it("done phase shows inline hints instead of steer messages", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "run-research.ts"), "utf-8");
    // Inline hints must use 💡 emoji or action callouts
    assert.ok(src.includes("💡"), "must use inline hint emoji");
    assert.ok(src.includes("export_pdf"), "must mention export_pdf tool");
    assert.ok(src.includes("mind_map"), "must mention mind_map tool");
  });
});

// ─── Dead telemetry: saveReportPath no longer takes telemetry ──
describe("saveReportPath — no dead telemetry param", () => {
  it("session-state.ts saveReportPath has no telemetry param", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "session-state.ts"), "utf-8");
    // saveReportPath must NOT have a telemetry parameter
    const sig = src.match(/saveReportPath\([^)]+\)/);
    assert.ok(sig, "saveReportPath signature must exist");
    assert.ok(!sig[0].includes("telemetry"), "saveReportPath must not have telemetry param");
  });

  it("run-research.ts does not pass empty string to saveReportPath", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "run-research.ts"), "utf-8");
    // saveReportPath call must not have "" as a telemetry argument
    const call = src.match(/saveReportPath\([^)]+\)/);
    assert.ok(call, "saveReportPath call must exist");
    assert.ok(!call[0].includes('""'), "must not pass empty string telemetry");
  });

  it("save-report.ts does not reference storedTelemetry", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "save-report.ts"), "utf-8");
    assert.ok(!src.includes("storedTelemetry"), "save_report must not reference storedTelemetry");
  });
});
