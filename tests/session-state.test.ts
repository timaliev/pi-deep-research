import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResearchDraft } from "../extension/research-draft.js";
import { SessionState } from "../extension/session-state.js";
import type { ResearchSnapshot } from "../extension/state-machine.js";

describe("SessionState — persistence seam", () => {
  function makeSnapshot(): ResearchSnapshot {
    return {
      phase: "saving",
      runId: "r1",
      currentDepth: 1,
      totalDepth: 2,
      allFindings: [],
      allVisitedUrls: [],
      draft: new ResearchDraft("long report...".repeat(10)),
      reportPath: "",
      searchCalls: 5,
      scrapeCalls: 8,
      startedAt: Date.now(),
      softLimitTriggered: false,
    };
  }

  it("saveState persists snapshot with encoded draft, omits draft object", () => {
    const entries: Array<{ customType: string; data: any }> = [];
    const session = new SessionState({ appendEntry: (t, d) => entries.push({ customType: t, data: d }) });
    const snap = makeSnapshot();

    session.saveState(snap, { plan: {}, planArtifactPath: "/p" });

    const saved = entries[0].data;
    assert.equal(entries[0].customType, "deep-research:state");
    assert.ok(typeof saved.draftEncoded === "string", "draftEncoded must be a string");
    assert.ok(saved.draftEncoded!.length > 0, "draftEncoded must not be empty");
    assert.ok(!("draft" in saved), "draft object omitted from persisted state");
    assert.ok(!("draftReport" in saved), "draftReport must not be in persisted state");
    assert.ok(!("draftReady" in saved), "draftReady proxy must not be in persisted state");
    assert.equal(saved.phase, "saving");
    assert.equal(saved.planArtifactPath, "/p", "extra fields merged");
  });

  it("restoreState recovers persisted state from session entries", () => {
    const entries = [
      { customType: "other", data: {} },
      { customType: "deep-research:state", data: { runId: "r1", phase: "extracting", currentDepth: 1 } },
    ];

    const state = SessionState.restoreState(entries);
    assert.ok(state, "must find state entry");
    assert.equal(state.runId, "r1");
    assert.equal(state.phase, "extracting");
  });

  it("restoreState returns undefined when no state entry exists", () => {
    const entries = [{ customType: "other", data: {} }];
    const state = SessionState.restoreState(entries);
    assert.equal(state, undefined);
  });

  it("saveReportPath stores path, dir, runId", () => {
    const entries: Array<{ customType: string; data: any }> = [];
    const session = new SessionState({ appendEntry: (t, d) => entries.push({ customType: t, data: d }) });

    session.saveReportPath("/tmp/r.md", "/tmp/reports", "run-123");

    assert.equal(entries[0].customType, "deep-research:report-path");
    assert.equal(entries[0].data.path, "/tmp/r.md");
    assert.equal(entries[0].data.reportsDir, "/tmp/reports");
    assert.equal(entries[0].data.runId, "run-123");
    assert.equal(entries[0].data.telemetry, undefined);
  });

  it("saveConfirmation stores plan path", () => {
    const entries: Array<{ customType: string; data: any }> = [];
    const session = new SessionState({ appendEntry: (t, d) => entries.push({ customType: t, data: d }) });

    session.saveConfirmation("/p/plan.json");
    assert.equal(entries[0].customType, "deep-research:plan-confirmed");
  });
});
