import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Simulate the session persistence boundary
describe("draftReport persistence safety", () => {
  it("draftReady flag survives serialization round-trip", () => {
    const snapshot = {
      phase: "saving",
      draftReport: "# Full Report\n\nThis is a comprehensive research report with many findings and detailed analysis across multiple sections.".repeat(5),
    };

    // Simulate: only persist safe fields, not the large string
    const safe = persistSnapshot(snapshot);
    assert.ok(safe.draftReady, "draftReady flag must be set");
    assert.equal(typeof safe.draftLength, "number", "draftLength must be a number, not the string");
    assert.ok(!("draftReport" in safe), "draftReport must NOT be in serialized state");
  });

  it("restore marks draftPresent when agent response has >= 40 chars", () => {
    const loaded = { phase: "saving", draftReady: true, draftLength: 5000 };
    const agentResponse = "# Full Report\n\nContent...".repeat(100); // 2500 chars

    const restored = restoreSnapshot(loaded, agentResponse);
    assert.ok(restored.draftReport.length >= 40);
    assert.equal(restored.draftReport, agentResponse);
  });

  it("restore falls back to empty when agent response missing", () => {
    const loaded = { phase: "saving", draftReady: true, draftLength: 5000 };

    const restored = restoreSnapshot(loaded, undefined);
    assert.equal(restored.draftReport, "");
  });

  it("saving phase without draftReady blocks transition", () => {
    const loaded = { phase: "saving", draftReady: false, draftLength: 0 };
    const agentResponse = "short";

    const restored = restoreSnapshot(loaded, agentResponse);
    assert.equal(restored.draftReport.length, 0);
    assert.equal(restored.phase, "saving"); // stays in saving, doesn't advance
  });
});

type SafeSnapshot = {
  phase: string;
  draftReady: boolean;
  draftLength: number;
};

function persistSnapshot(snapshot: { phase: string; draftReport: string }): SafeSnapshot {
  const hasDraft = snapshot.draftReport && snapshot.draftReport.length >= 40;
  return {
    phase: snapshot.phase,
    draftReady: hasDraft,
    draftLength: hasDraft ? snapshot.draftReport.length : 0,
  };
}

function restoreSnapshot(
  loaded: SafeSnapshot,
  agentResponse?: string,
): { phase: string; draftReport: string } {
  if (!loaded.draftReady) {
    return { phase: loaded.phase, draftReport: "" };
  }
  const text = extractTextContent(agentResponse);
  const hasValidDraft = text && text.length >= 40;
  return {
    phase: loaded.phase,
    draftReport: hasValidDraft ? text : "",
  };
}

function extractTextContent(agentResponse?: unknown): string {
  if (!agentResponse) return "";
  if (typeof agentResponse === "string") return agentResponse;
  if (Array.isArray(agentResponse)) {
    return (agentResponse as any[])
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}
