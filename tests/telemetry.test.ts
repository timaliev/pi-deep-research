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

  it("includes profile name and parameters when profileName is passed", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);
    snapshot.profile = { breadth: 6, depth: 3, concurrency: 4 };
    const section = buildTelemetrySection(snapshot, undefined, undefined, "deep");
    assert.ok(section.includes("| Profile | deep |"), "must show profile name");
    assert.ok(section.includes("| Breadth | 6 |"), "must show breadth");
    assert.ok(section.includes("| Depth | 3 |"), "must show depth");
    assert.ok(section.includes("| Concurrency | 4 |"), "must show concurrency");
  });

  it("shows optional max limits when set", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);
    snapshot.profile = { breadth: 4, depth: 2, concurrency: 4, maxSearchCalls: 100, maxElapsedSeconds: 300 };
    const section = buildTelemetrySection(snapshot, undefined, undefined, "exhaustive");
    assert.ok(section.includes("| Max search calls | 100 |"), "must show max search calls");
    assert.ok(section.includes("| Max elapsed (s) | 300 |"), "must show max elapsed seconds");
  });

  it("omits max limits when not set", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);
    snapshot.profile = { breadth: 4, depth: 2, concurrency: 4 };
    const section = buildTelemetrySection(snapshot, undefined, undefined, "default");
    assert.ok(!section.includes("Max search calls"), "must not show max search calls when unset");
    assert.ok(!section.includes("Max elapsed"), "must not show max elapsed when unset");
  });

  it("uses Pi Extension version label instead of Version", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);
    const section = buildTelemetrySection(snapshot, "0.16.2");
    assert.ok(section.includes("| Pi Extension version |"), "must use Pi Extension version label");
    assert.ok(!section.includes("| Version |"), "must not use bare Version label");
  });

  it("omits profile section when no profileName passed (backward compat)", () => {
    const snapshot = ResearchStateMachine.init(MOCK_PLAN);
    const section = buildTelemetrySection(snapshot);
    assert.ok(!section.includes("| Profile |"), "must not show Profile when profileName is undefined");
  });
});
