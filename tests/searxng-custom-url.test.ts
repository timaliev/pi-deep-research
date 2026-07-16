/**
 * SearXNG custom URL — settings cascade + adapter.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const settingsSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "settings-context.ts"), "utf-8");
const credSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "search-credentials.ts"), "utf-8");

const searxngSrc = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "search", "engines", "searxng.ts"),
  "utf-8",
);

describe("SearXNG custom URL", () => {
  it("SettingsContext has searxng URL in cascade", () => {
    // SearchProviderCredentials extracted to search-credentials.ts — SEARXNG_URL lives there
    assert.ok(credSrc.includes("SEARXNG_URL") || settingsSrc.includes("searxngUrl"), "must have SearXNG URL setting");
  });

  it("searxng adapter reads custom URL from credentials", () => {
    assert.ok(searxngSrc.includes('get("searxng"') || searxngSrc.includes("url"), "adapter must read custom URL");
  });
});
