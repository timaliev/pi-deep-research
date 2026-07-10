/**
 * Test that deep_web_search tool StringEnum includes all supported search engines.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const indexCode = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "web-search.ts"), "utf-8");

describe("deep_web_search tool registration", () => {
  it("StringEnum includes duckduckgo, brave, searxng, tavily, yandex", () => {
    const match = indexCode.match(/StringEnum\(\[([^\]]+)\]/);
    assert.ok(match, "StringEnum for engines must exist");
    const engines = match[1]
      .replace(/"/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    assert.ok(engines.includes("duckduckgo"), "must include duckduckgo");
    assert.ok(engines.includes("brave"), "must include brave");
    assert.ok(engines.includes("searxng"), "must include searxng");
    assert.ok(engines.includes("tavily"), "must include tavily");
    assert.ok(engines.includes("yandex"), "must include yandex");
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
    const descMatch = indexCode.match(/description:\s*`([^`]+)`/);
    assert.ok(descMatch, "description must exist");
    const desc = descMatch[1];
    assert.ok(desc.length <= 250, `description too long: ${desc.length} chars (max 250)`);
    assert.ok(!desc.includes("DuckDuckGo uses honest bot UA"), "no engine-specific docs in description");
  });
});
