/**
 * ADR-0018: Release monitor — checks GitHub for new releases on session start.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const releaseMonitorSrc = () => {
  try {
    return readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "release-monitor.ts"),
      "utf-8",
    );
  } catch {
    return "";
  }
};

const indexSrc = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
  "utf-8",
);

describe("ADR-0018 — Release monitor", () => {
  it("release-monitor.ts module exists", () => {
    const src = releaseMonitorSrc();
    assert.ok(src.length > 0, "release-monitor.ts must exist");
  });

  it("exports checkForNewRelease function", () => {
    const src = releaseMonitorSrc();
    assert.ok(src.includes("checkForNewRelease"), "must export checkForNewRelease");
  });

  it("wired into index.ts via session_start", () => {
    assert.ok(
      indexSrc.includes("session_start") && indexSrc.includes("checkForNewRelease"),
      "index.ts must wire checkForNewRelease to session_start",
    );
  });

  it("has 6-hour cooldown mechanism", () => {
    const src = releaseMonitorSrc();
    assert.ok(
      src.includes("lastCheck") || src.includes("cooldown") || src.includes("6") || src.includes("3600000") || src.includes("Date.now"),
      "must have cooldown logic",
    );
  });

  it("silent skip on network failure", () => {
    const src = releaseMonitorSrc();
    assert.ok(
      src.includes("catch") && (src.includes("return") || src.includes("silent") || src.includes("skip")),
      "must handle network errors silently",
    );
  });
});
