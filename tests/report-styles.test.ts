import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReportStyle } from "../extension/report-styles.js";
import type { ResearchPlan } from "../extension/prefilter.js";

describe("NarrativeStyle", () => {
  const plan: ResearchPlan = {
    topic: "test", goal: "test goal", researchQuestions: ["q1"],
    engines: ["duckduckgo"], profile: { name: "default" },
    scope: { include: "", exclude: "" },
    estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
    reportStyle: "narrative",
  };

  it("extraction prompt mentions findings and citations", () => {
    const style = createReportStyle("narrative");
    const prompt = style.buildExtractionPrompt(
      [{ question: "q1", results: [] }], [], 1, 2,
    );
    assert.ok(prompt.includes("Extract"));
    assert.ok(prompt.includes("source URL"));
  });

  it("questioning prompt asks for follow-up questions", () => {
    const style = createReportStyle("narrative");
    const prompt = style.buildQuestioningPrompt(plan, 1, 2);
    assert.ok(prompt.includes("follow-up"));
    assert.ok(prompt.includes("test goal"));
  });

  it("drafting prompt uses 5-section template", () => {
    const style = createReportStyle("narrative");
    const prompt = style.buildDraftingPrompt(plan, []);
    assert.ok(prompt.includes("Introduction"));
    assert.ok(prompt.includes("Recommendations"));
  });
});

describe("SubtopicStyle", () => {
  const plan: ResearchPlan = {
    topic: "test", goal: "test goal", researchQuestions: ["q1"],
    engines: ["duckduckgo"], profile: { name: "default" },
    scope: { include: "", exclude: "" },
    estimatedCost: { searchCalls: 1, scrapeCalls: 1, description: "" },
    reportStyle: "subtopics",
  };

  it("extraction prompt instructs thematic grouping", () => {
    const style = createReportStyle("subtopics");
    const prompt = style.buildExtractionPrompt(
      [{ question: "q1", results: [] }], [], 1, 2,
    );
    assert.ok(prompt.includes("theme"));
  });

  it("questioning prompt asks for theme-refining questions", () => {
    const style = createReportStyle("subtopics");
    const prompt = style.buildQuestioningPrompt(plan, 1, 2);
    assert.ok(prompt.includes("theme"));
  });

  it("drafting prompt does NOT use 5-section template", () => {
    const style = createReportStyle("subtopics");
    const prompt = style.buildDraftingPrompt(plan, []);
    assert.ok(!prompt.includes("1. **Introduction**"));
  });
});

describe("createReportStyle dispatch", () => {
  const plan: ResearchPlan = {
    topic: "t", goal: "g", researchQuestions: [], engines: [],
    profile: { name: "default" }, scope: { include: "", exclude: "" },
    estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
  };

  it("returns NarrativeStyle for 'narrative'", () => {
    const prompt = createReportStyle("narrative").buildDraftingPrompt(plan, []);
    assert.ok(prompt.includes("Introduction"));
  });

  it("returns SubtopicStyle for 'subtopics'", () => {
    const prompt = createReportStyle("subtopics").buildDraftingPrompt(plan, []);
    assert.ok(!prompt.includes("1. **Introduction**"));
  });

  it("falls back to narrative for unknown style", () => {
    const prompt = createReportStyle("unknown").buildDraftingPrompt(plan, []);
    assert.ok(prompt.includes("Introduction"));
  });
});
