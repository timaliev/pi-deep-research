import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractTextContent } from "../extension/research-run-orchestrator.js";

describe("extractTextContent", () => {
  it("returns string unchanged (no tool XML)", () => {
    assert.equal(extractTextContent("hello world"), "hello world");
  });

  it("extracts text from content blocks array (TextContent + ToolCall)", () => {
    const blocks = [
      { type: "text", text: "## Research Report\n\nFull markdown report." },
      { type: "toolCall", id: "tool_1", name: "run_research", arguments: {} },
    ];
    const result = extractTextContent(blocks);
    assert.ok(result.includes("## Research Report"));
    assert.ok(!result.includes("toolCall"));
  });

  it("returns empty for undefined/null/empty", () => {
    assert.equal(extractTextContent(undefined), "");
    assert.equal(extractTextContent(null), "");
    assert.equal(extractTextContent([]), "");
    assert.equal(extractTextContent(""), "");
  });

  it("strips tool-call XML from string (real agent response)", () => {
    const agentStr = `## Consolidated Report: Virtualization Market RF

### 1. Executive Summary
The Russian virtualization market is growing rapidly.

### 2. Key Findings
Detailed findings with citations.

<tool_calls>
<invoke name="run_research">
<parameter name="plan_artifact_path" string="true">/path/to/prefilter.json</parameter>
</invoke>
</tool_calls>`;

    const result = extractTextContent(agentStr);
    assert.ok(result.includes("## Consolidated Report"));
    assert.ok(result.includes("Executive Summary"));
    assert.ok(result.includes("Key Findings"));
    assert.ok(!result.includes("<tool_calls>"));
    assert.ok(!result.includes("run_research"));
    assert.ok(!result.includes("</invoke>"));
  });

  it("handles plain report text (no tool calls at all)", () => {
    const report = "# Report\n\nJust a simple report text.";
    assert.equal(extractTextContent(report), report);
  });

  it("handles string with only tool-call XML and minimal prefix", () => {
    // Simulates the 56-byte prefix case: just a few words before tool XML
    const agentStr = `Here is the report

<tool_calls>
<invoke name="run_research">
<parameter name="plan_artifact_path" string="true">/path</parameter>
</invoke>
</tool_calls>`;
    const result = extractTextContent(agentStr);
    assert.equal(result.trim(), "Here is the report");
    assert.equal(result.length, "Here is the report".length);
  });

  it("handles multi-paragraph report with tool XML at end", () => {
    const agentStr = `# Research Report

## Section 1
Content with multiple paragraphs.

## Section 2
More content here.

## Sources
- Source A
- Source B

<tool_calls>
<invoke name="run_research">
<parameter name="plan_artifact_path" string="true">/path</parameter>
</invoke>
</tool_calls>`;

    const result = extractTextContent(agentStr);
    assert.ok(result.includes("# Research Report"));
    assert.ok(result.includes("## Section 1"));
    assert.ok(result.includes("## Section 2"));
    assert.ok(result.includes("## Sources"));
    assert.ok(result.includes("Source A"));
    assert.ok(!result.includes("<tool_calls>"));
  });

  it("handles ThinkingContent blocks in array", () => {
    const blocks = [
      { type: "thinking", thinking: "let me think about this..." },
      { type: "text", text: "## Report\n\nFinal report content." },
    ];
    const result = extractTextContent(blocks);
    assert.equal(result, "## Report\n\nFinal report content.");
    assert.ok(!result.includes("thinking"));
  });

  it("returns empty when string is just tool XML", () => {
    const agentStr = `<tool_calls>
<invoke name="run_research">
<parameter name="plan_artifact_path" string="true">/path</parameter>
</invoke>
</tool_calls>`;

    const result = extractTextContent(agentStr);
    assert.ok(result.length < 20, "should be nearly empty");
  });
});
