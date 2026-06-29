import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTelemetrySection } from "../extension/state-machine.js";
import type { ResearchSnapshot } from "../extension/state-machine.js";

function makeSnapshot(overrides?: Partial<ResearchSnapshot>): ResearchSnapshot {
  return {
    phase: "done", runId: "test-run", currentDepth: 2, totalDepth: 3,
    allFindings: [], allVisitedUrls: [], draftReport: "", reportPath: "",
    searchCalls: 5, scrapeCalls: 7, startedAt: Date.now() - 100_000,
    softLimitTriggered: false, ...overrides,
  };
}

describe("buildTelemetrySection artifact links", () => {
  it("renders artifact links section when links provided", () => {
    const links = [
      "../artifacts/test-prefilter.json",
      "../logs/test.log",
    ];
    const section = buildTelemetrySection(makeSnapshot(), "0.13.3", links);

    assert.ok(section.includes("## Artifacts"), "must have Artifacts heading");
    assert.ok(section.includes("[../artifacts/test-prefilter.json]"),
      "must link to prefilter artifact");
    assert.ok(section.includes("[../logs/test.log]"),
      "must link to log file");
  });

  it("omits artifact section when no links provided", () => {
    const section = buildTelemetrySection(makeSnapshot(), undefined, []);
    assert.ok(!section.includes("## Artifacts"));
  });

  it("omits artifact section when undefined links", () => {
    const section = buildTelemetrySection(makeSnapshot());
    assert.ok(!section.includes("## Artifacts"));
  });

  it("artifact links appear after telemetry table", () => {
    const section = buildTelemetrySection(makeSnapshot(), "1.0", ["../logs/x.log"]);
    const telemetryIdx = section.indexOf("## Research Telemetry");
    const artifactsIdx = section.indexOf("## Artifacts");

    assert.ok(telemetryIdx >= 0);
    assert.ok(artifactsIdx > telemetryIdx, "Artifacts must come after Telemetry");
  });

  it("each link is a markdown link with the path as text", () => {
    const links = ["../logs/a.log", "../artifacts/b.json"];
    const section = buildTelemetrySection(makeSnapshot(), undefined, links);

    assert.ok(section.includes("- [../logs/a.log](../logs/a.log)"));
    assert.ok(section.includes("- [../artifacts/b.json](../artifacts/b.json)"));
  });
});
