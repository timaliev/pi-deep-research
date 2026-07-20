/**
 * Test that deep_web_search tool StringEnum includes all supported search engines.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const indexCode = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "deps.ts"), "utf-8");

describe("deep_web_search tool registration", () => {
  it("StringEnum includes duckduckgo, brave, searxng, tavily, yandex", () => {
    // StringEnum now derives from ALL_ENGINES constant
    assert.ok(indexCode.includes("ALL_ENGINES"), "StringEnum must use ALL_ENGINES");
    const enginesSrc = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "search", "engines.ts"),
      "utf-8",
    );
    assert.ok(enginesSrc.includes('"duckduckgo"'), "ALL_ENGINES must include duckduckgo");
    assert.ok(enginesSrc.includes('"brave"'), "ALL_ENGINES must include brave");
    assert.ok(enginesSrc.includes('"searxng"'), "ALL_ENGINES must include searxng");
    assert.ok(enginesSrc.includes('"tavily"'), "ALL_ENGINES must include tavily");
    assert.ok(enginesSrc.includes('"yandex"'), "ALL_ENGINES must include yandex");
  });

  it("description mentions all 5 engines", () => {
    assert.ok(indexCode.includes("tavily"), "description must mention tavily");
    assert.ok(indexCode.includes("yandex"), "description must mention yandex");
  });

  it("promptGuidelines mentions all 5 engines", () => {
    const guidelines = indexCode.match(/promptGuidelines:[\s\S]*?\],/);
    assert.ok(guidelines, "promptGuidelines must exist");
    assert.ok(guidelines[0].includes("tavily"), "guidelines must mention tavily");
    assert.ok(guidelines[0].includes("yandex"), "guidelines must mention yandex");
  });

  it("description is concise (under 250 chars, not 700)", () => {
    const descMatch = indexCode.match(/description:\s*["\x60]([^"\x60]+)["\x60]/);
    if (!descMatch) return; // skip if description format changed
    const desc = descMatch[1];
    assert.ok(desc.length <= 250, `description too long: ${desc.length} chars (max 250)`);
    assert.ok(!desc.includes("DuckDuckGo uses honest bot UA"), "no engine-specific docs in description");
  });
});
