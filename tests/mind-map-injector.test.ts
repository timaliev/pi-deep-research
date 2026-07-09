import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMindMapPrompt } from "../extension/mind-map-injector.js";

describe("buildMindMapPrompt", () => {
  it("includes topic in the prompt", () => {
    const prompt = buildMindMapPrompt("Test Topic", undefined, "some content");
    assert.ok(prompt.includes("Test Topic"), "must include topic");
  });

  it("includes Mermaid graph TD instruction", () => {
    const prompt = buildMindMapPrompt("Topic", undefined, "content");
    assert.ok(prompt.includes("```mermaid"), "must mention mermaid code block");
    assert.ok(prompt.includes("graph TD"), "must specify graph TD");
  });

  it("uses findings when provided", () => {
    const findings = "1. First finding\n2. Second finding\n3. Third finding";
    const prompt = buildMindMapPrompt("Topic", findings, undefined);
    assert.ok(prompt.includes("Key findings:"), "must show Key findings header");
    assert.ok(prompt.includes("First finding"), "must include finding text");
    assert.ok(!prompt.includes("**Content:**"), "must NOT show raw content header when findings provided");
  });

  it("uses rawContent when findings not provided", () => {
    const content = "Raw content text for mind map generation";
    const prompt = buildMindMapPrompt("Topic", undefined, content);
    assert.ok(prompt.includes("**Content:**"), "must show Content header");
    assert.ok(prompt.includes("Raw content text"), "must include content");
    assert.ok(!prompt.includes("Key findings:"), "must NOT show Key findings when only raw content");
  });

  it("prefers findings over rawContent when both provided", () => {
    const prompt = buildMindMapPrompt("Topic", "findings text", "raw content");
    assert.ok(prompt.includes("Key findings:"), "must show Key findings");
    assert.ok(!prompt.includes("**Content:**"), "must NOT show raw content when findings present");
  });

  it("includes savePath hint when provided", () => {
    const prompt = buildMindMapPrompt("Topic", "findings", undefined, "/tmp/mindmap.md");
    assert.ok(prompt.includes("/tmp/mindmap.md"), "must include file path");
    assert.ok(prompt.includes("Save the diagram block to:"), "must mention save");
  });

  it("omits savePath hint when not provided", () => {
    const prompt = buildMindMapPrompt("Topic", "findings");
    assert.ok(!prompt.includes("Save the diagram block to:"), "must NOT mention save when no path");
  });

  it("truncates rawContent to 3000 chars", () => {
    const long = "x".repeat(5000);
    const prompt = buildMindMapPrompt("Topic", undefined, long);
    const contentStart = prompt.indexOf("**Content:**\n") + "**Content:**\n".length;
    const contentText = prompt.slice(contentStart).split("\n\n")[0];
    assert.ok(contentText.length <= 3010, "content must be truncated to ~3000 chars");
  });

  it("includes short node labels and hierarchy instruction", () => {
    const prompt = buildMindMapPrompt("Topic", "findings");
    assert.ok(prompt.includes("short node labels"), "must mention short labels");
    assert.ok(prompt.includes("hierarchy with arrows"), "must mention hierarchy");
  });
});
