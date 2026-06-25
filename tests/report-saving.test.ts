import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Report saving", () => {
  it("finds assistant message via entry.message.role, not entry.type or entry.role", () => {
    // SessionMessageEntry has { type: "message", message: { role: "assistant", content: "hello" } }
    // NOT { type: "assistant", content: "hello" }
    const mockEntries = [
      {
        type: "message",
        customType: undefined,
        id: "1",
        parentId: null,
        timestamp: "",
        message: { role: "user", content: "hi" },
      },
      {
        type: "message",
        customType: undefined,
        id: "2",
        parentId: null,
        timestamp: "",
        message: { role: "assistant", content: "The report content" },
      },
    ];

    // Find last assistant — check message.role, not entry.type
    const lastAssistant = [...mockEntries].reverse().find(
      (e: any) => e.message?.role === "assistant"
    );
    assert.ok(lastAssistant, "must find assistant entry");
    assert.equal(lastAssistant?.message?.content, "The report content");
  });

  it("old filter (e.type === 'assistant' || e.role === 'assistant') never matches SessionMessageEntry", () => {
    const mockEntries = [
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "",
        message: { role: "assistant", content: "hello" },
      },
    ];

    const found = [...mockEntries].reverse().find(
      (e: any) => e.type === "assistant" || e.role === "assistant"
    );
    assert.equal(found, undefined, "old filter must not match SessionMessageEntry");
  });
});
