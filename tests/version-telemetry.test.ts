import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { ResearchDraft } from "../extension/research-draft.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTelemetrySection, readExtensionVersion } from "../extension/report-assembly.js";
import type { ResearchSnapshot } from "../extension/state-machine.js";

const baseDir = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(baseDir, "..", "test-version-telemetry");

function makeSnapshot(overrides?: Partial<ResearchSnapshot>): ResearchSnapshot {
  return {
    phase: "done",
    runId: "test-run",
    currentDepth: 2,
    totalDepth: 3,
    allFindings: [],
    allVisitedUrls: ["https://a.com"],
    draft: new ResearchDraft(),
    reportPath: "",
    searchCalls: 5,
    scrapeCalls: 7,
    startedAt: Date.now() - 100_000,
    softLimitTriggered: false,
    ...overrides,
  };
}

describe("buildTelemetrySection with version", () => {
  it("includes version row when version string provided", () => {
    const snap = makeSnapshot();
    const section = buildTelemetrySection(snap, "0.13.1");

    assert.ok(section.includes("| Pi Extension version |"), "must have Pi Extension version row");
    assert.ok(section.includes("`0.13.1`"), "must include version number");
  });

  it("omits version row when no version provided (backward compat)", () => {
    const snap = makeSnapshot();
    const section = buildTelemetrySection(snap);

    assert.ok(!section.includes("| Pi Extension version |"), "must NOT have version row when undefined");
    assert.ok(section.includes("| Run ID |"), "must still have other rows");
  });

  it("version row appears near top of table (after Run ID)", () => {
    const snap = makeSnapshot();
    const section = buildTelemetrySection(snap, "1.2.3");

    const lines = section.split("\n");
    const runIdIdx = lines.findIndex((l) => l.includes("Run ID"));
    const versionIdx = lines.findIndex((l) => l.includes("Pi Extension version"));

    assert.ok(runIdIdx >= 0, "Run ID row must exist");
    assert.ok(versionIdx >= 0, "Pi Extension version row must exist");
    assert.equal(versionIdx, runIdIdx + 1, "Pi Extension version must be right after Run ID");
  });
});

describe("readExtensionVersion from package.json", () => {
  beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("reads version from valid package.json", () => {
    const pkgPath = join(TEST_DIR, "package.json");
    writeFileSync(pkgPath, JSON.stringify({ name: "test", version: "2.5.0" }), "utf-8");

    const version = readExtensionVersion(pkgPath);
    assert.equal(version, "2.5.0");
  });

  it("returns undefined when package.json missing", () => {
    const version = readExtensionVersion(join(TEST_DIR, "nonexistent.json"));
    assert.equal(version, undefined);
  });

  it("returns undefined when package.json has no version field", () => {
    const pkgPath = join(TEST_DIR, "package.json");
    writeFileSync(pkgPath, JSON.stringify({ name: "test" }), "utf-8");

    const version = readExtensionVersion(pkgPath);
    assert.equal(version, undefined);
  });
});
