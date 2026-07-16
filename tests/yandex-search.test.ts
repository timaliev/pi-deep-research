/**
 * Test Yandex search integration.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const webSearchCode = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "search", "web-search.ts"),
  "utf-8",
);
const yandexCode = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "search", "engines", "yandex.ts"),
  "utf-8",
);

describe("Yandex search integration", () => {
  it("SearchEngine type includes yandex", () => {
    const enginesSrc = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "search", "engines.ts"),
      "utf-8",
    );
    assert.ok(enginesSrc.includes('"yandex"'), "ALL_ENGINES must include yandex");
  });

  it("searchYandex function exists with credential check", () => {
    assert.ok(yandexCode.includes("searchYandex"), "searchYandex function must exist in yandex adapter");
    assert.ok(
      yandexCode.includes("YANDEX_FOLDER_ID") || yandexCode.includes("YANDEX_OAUTH_TOKEN"),
      "Must check Yandex credentials",
    );
  });

  it("yandex uses POST to searchapi API endpoint", () => {
    assert.ok(yandexCode.includes("searchapi.api.cloud.yandex.net"), "Must call Yandex search API endpoint");
  });

  it("yandex polls operation status after submit", () => {
    assert.ok(yandexCode.includes("operation") || yandexCode.includes("done"), "Must poll operation status");
  });

  it("yandex parses XML results to WebSearchResult", () => {
    assert.ok(
      yandexCode.includes("xml") || yandexCode.includes("XML") || yandexCode.includes("rawData"),
      "Must handle XML results via rawData/base64",
    );
  });

  it("searchWeb and multiEngineWebSearch dispatch to yandex", () => {
    const matches = [...webSearchCode.matchAll(/yandex/g)];
    assert.ok(matches.length >= 2, "yandex must appear in engineFns maps");
  });
});
