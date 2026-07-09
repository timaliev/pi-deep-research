import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine } from "../extension/state-machine.js";
import { ProfileResolver } from "../extension/profile-resolver.js";

function makePlan(overrides?: Partial<any>): any {
  return {
    topic: "test",
    goal: "test",
    researchQuestions: ["q1"],
    engines: ["duckduckgo"],
    profile: { name: "default" },
    scope: { include: "all", exclude: "none" },
    estimatedCost: { searchCalls: 5, scrapeCalls: 3, description: "test" },
    ...overrides,
  };
}

describe("State machine defaultReportStyle", () => {
  it("uses plan.reportStyle when set, ignoring defaultReportStyle", async () => {
    const resolver = new ProfileResolver({});
    const machine = new ResearchStateMachine({
      searchFn: async () => [],
      scraper: { scrape: async () => ({ url: "", title: "", content: "" }) } as any,
      profileResolver: resolver,
      defaultReportStyle: "narrative",
    });
    const plan = makePlan({ reportStyle: "subtopics" });
    const snapshot = ResearchStateMachine.init(plan, resolver);
    const result = await machine.next(snapshot, plan);
    // subtopics extraction prompt mentions themes, not 5-section
    assert.ok(result.inject!.includes("group"), "subtopics extraction must mention grouping");
    assert.ok(!result.inject!.includes("5."), "subtopics extraction must NOT have 5 numbered sections");
  });

  it("falls back to defaultReportStyle when plan has no reportStyle", async () => {
    const resolver = new ProfileResolver({});
    const machine = new ResearchStateMachine({
      searchFn: async () => [],
      scraper: { scrape: async () => ({ url: "", title: "", content: "" }) } as any,
      profileResolver: resolver,
      defaultReportStyle: "subtopics",
    });
    const plan = makePlan(); // no reportStyle
    const snapshot = ResearchStateMachine.init(plan, resolver);
    const result = await machine.next(snapshot, plan);
    // should use subtopics extraction (themes, not 5-section)
    assert.ok(result.inject!.includes("group"), "subtopics extraction must mention grouping");
    assert.ok(!result.inject!.includes("5."), "subtopics extraction must NOT have 5 numbered sections");
  });

  it("falls back to narrative when neither plan nor defaultReportStyle set", async () => {
    const resolver = new ProfileResolver({});
    const machine = new ResearchStateMachine({
      searchFn: async () => [],
      scraper: { scrape: async () => ({ url: "", title: "", content: "" }) } as any,
      profileResolver: resolver,
    });
    const plan = makePlan(); // no reportStyle, no defaultReportStyle
    const snapshot = ResearchStateMachine.init(plan, resolver);
    const result = await machine.next(snapshot, plan);
    // should use narrative extraction (5-section)
    assert.ok(result.inject!.includes("insight"), "narrative extraction must mention insight");
    assert.ok(result.inject!.includes("Source URL"), "narrative extraction must include Source URL");
  });
});
