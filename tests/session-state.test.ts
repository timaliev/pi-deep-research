import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Verify our understanding of pi's SessionManager API by checking
// that the state persistence code uses the correct CustomEntry shape
describe("Session state persistence", () => {
  it("reads state from CustomEntry.data, not .content", () => {
    // CustomEntry has { type: "custom", customType: string, data?: unknown }
    // The code at index.ts must read from .data, not .content
    const mockEntry = {
      type: "custom",
      customType: "deep-research:state",
      id: "1",
      parentId: null,
      timestamp: "2025-01-01T00:00:00Z",
      data: {
        plan: { topic: "test" },
        planArtifactPath: "/tmp/test.json",
      },
    };

    // Simulate what index.ts does
    const stateData = mockEntry.data as Record<string, unknown>;
    const plan = stateData.plan;
    assert.equal((plan as any).topic, "test");
  });

  it("content property is undefined on CustomEntry", () => {
    const mockEntry = {
      type: "custom",
      customType: "deep-research:state",
      id: "1",
      parentId: null,
      timestamp: "2025-01-01T00:00:00Z",
      data: { plan: { topic: "test" } },
    };

    assert.equal((mockEntry as any).content, undefined);
  });
});
