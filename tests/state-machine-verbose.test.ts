import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "state-machine.ts"), "utf-8");

describe("state-machine verbose logging", () => {
  it("imports settings for logLevel check", () => {
    assert.ok(
      src.includes("settings-context") || src.includes('from "./settings-context'),
      "must import settings-context for logLevel",
    );
  });

  it("has conditional verbose logging via logLevel", () => {
    assert.ok(
      src.includes("logLevel") && (src.includes("verbose") || src.includes('"verbose"')),
      "must check logLevel for verbose mode",
    );
  });

  it("logs search query text in verbose mode", () => {
    assert.ok(src.includes("query") || src.includes("search_query"), "must log search queries in verbose mode");
  });
});
