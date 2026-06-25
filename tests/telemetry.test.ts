import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResearchStateMachine, buildTelemetrySection } from "../extension/state-machine.js";
import type { ResearchPlan } from "../extension/prefilter.js";

const MOCK_PLAN: ResearchPlan = {
  topic: "Test", goal: "Test", researchQuestions: ["Q1"],
  engines: ["duckduckgo"], profile: { name: "default" },
  scope: { include: "", exclude: "" },
  estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
};

describe("Telemetry", () => {
  it("buildTelemetrySection includes all key metrics", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);
    snapshot.searchCalls = 8; snapshot.scrapeCalls = 6;
    snapshot.allVisitedUrls = ["a", "b", "c"]; snapshot.currentDepth = 2; snapshot.softLimitTriggered = false;
    const section = buildTelemetrySection(snapshot);
    assert.ok(section.includes("Research Telemetry"));
    assert.ok(section.includes("8")); assert.ok(section.includes("6"));
    assert.ok(section.includes("3")); assert.ok(section.includes("2/2"));
    assert.ok(section.includes("no"));
  });

  it("shows soft limit triggered as yes", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);
    snapshot.softLimitTriggered = true;
    assert.ok(buildTelemetrySection(snapshot).includes("yes"));
  });

  it("is valid markdown table format", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);
    const section = buildTelemetrySection(snapshot);
    assert.ok(section.includes("| Metric | Value |"));
    assert.ok(section.includes("| --- |"));
    assert.ok(!section.includes("undefined"));
  });
});
