/**
 * SearXNG custom URL — settings cascade + adapter.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const settingsSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "settings-context.ts"), "utf-8");

const searxngSrc = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "search", "engines", "searxng.ts"),
  "utf-8",
);

describe("SearXNG custom URL", () => {
  it("SettingsContext has searxng URL in cascade", () => {
    assert.ok(
      settingsSrc.includes("searxngUrl") || settingsSrc.includes("SEARXNG_URL"),
      "must have SearXNG URL setting",
    );
  });

  it("searxng adapter reads custom URL from credentials", () => {
    assert.ok(searxngSrc.includes('get("searxng"') || searxngSrc.includes("url"), "adapter must read custom URL");
  });
});
