import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SessionState } from "../extension/session-state.js";
import type { ResearchSnapshot } from "../extension/state-machine.js";

describe("SessionState — persistence seam", () => {
  function makeSnapshot(): ResearchSnapshot {
    return {
      phase: "saving", runId: "r1", currentDepth: 1, totalDepth: 2,
      allFindings: [], allVisitedUrls: [], draftReport: "long report...".repeat(10),
      reportPath: "", searchCalls: 5, scrapeCalls: 8, startedAt: Date.now(),
      softLimitTriggered: false,
    };
  }

  it("saveResearchState persists without draftReport string", () => {
    const entries: Array<{ customType: string; data: any }> = [];
    const session = new SessionState({ appendEntry: (t, d) => entries.push({ customType: t, data: d }) });
    const snap = makeSnapshot();

    session.saveResearchState(snap, { plan: {}, planArtifactPath: "/p" });

    const saved = entries[0].data;
    assert.equal(saved.draftReady, true, "draftReady flag set");
    assert.ok(!("draftReport" in saved), "draftReport stripped");
    assert.equal(saved.phase, "saving");
  });

  it("saveReportPath stores path, dir, telemetry", () => {
    const entries: Array<{ customType: string; data: any }> = [];
    const session = new SessionState({ appendEntry: (t, d) => entries.push({ customType: t, data: d }) });

    session.saveReportPath("/tmp/r.md", "/tmp/reports", "## Telemetry");

    assert.equal(entries[0].customType, "deep-research:report-path");
    assert.equal(entries[0].data.path, "/tmp/r.md");
    assert.equal(entries[0].data.reportsDir, "/tmp/reports");
    assert.equal(entries[0].data.telemetry, "## Telemetry");
  });

  it("saveConfirmation stores plan path", () => {
    const entries: Array<{ customType: string; data: any }> = [];
    const session = new SessionState({ appendEntry: (t, d) => entries.push({ customType: t, data: d }) });

    session.saveConfirmation("/p/plan.json");
    assert.equal(entries[0].customType, "deep-research:plan-confirmed");
  });

  it("restoreDraft re-extracts from agent response", () => {
    const stateData = { draftReady: true, draftLength: 200 };
    const agentResp = "# Report\n\nFull content here...".repeat(5);

    const session = new SessionState({ appendEntry: () => {} });
    const restored = session.restoreDraft(stateData, agentResp);

    assert.ok(restored.length > 40);
    assert.ok(restored.includes("# Report"));
  });

  it("restoreDraft returns empty when draftReady is false", () => {
    const session = new SessionState({ appendEntry: () => {} });
    assert.equal(session.restoreDraft({ draftReady: false }, "text"), "");
  });
});
