import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ResearchSnapshot } from "../extension/state-machine.js";
import { ResearchDraft } from "../extension/research-draft.js";

// Dynamic import to verify module compiles
describe("ReportAssembly module", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `report-assembly-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports assembleReport function", async () => {
    const mod = await import("../extension/report-assembly.js");
    assert.ok(typeof mod.assembleReport === "function", "must export assembleReport");
  });

  it("assembles report with markdown + telemetry + artifact links", async () => {
    const { assembleReport } = await import("../extension/report-assembly.js");
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const logsDir = join(tmpDir, "logs");
    mkdirSync(logsDir, { recursive: true });

    const snapshot: ResearchSnapshot = {
      phase: "done",
      runId: "test-run",
      currentDepth: 2,
      totalDepth: 3,
      allFindings: [],
      allVisitedUrls: ["https://a.com", "https://b.com"],
      draft: new ResearchDraft("# Test Report\n\nContent."),
      reportPath: "",
      searchCalls: 5,
      scrapeCalls: 7,
      startedAt: Date.now() - 60_000,
      softLimitTriggered: false,
    };

    const reportPath = assembleReport({
      snapshot,
      topic: "Test Topic",
      reportsDir,
      planArtifactPath: "/tmp/prefilter.json",
      logsDir,
      extensionVersion: "1.0.0",
      profileName: "default",
    });

    assert.ok(existsSync(reportPath), "report file must exist");
    const content = readFileSync(reportPath, "utf-8");
    assert.ok(content.includes("# Test Report"), "must include markdown body");
    assert.ok(content.includes("## Research Telemetry"), "must include telemetry");
    assert.ok(content.includes("prefilter.json"), "must include artifact link");
    // Telemetry table includes version (label may vary — "Version" or "Pi Extension version")
    assert.ok(content.includes("1.0.0"), "must include version number");
  });

  it("warns when draft is too short", async () => {
    const { assembleReport } = await import("../extension/report-assembly.js");
    const reportsDir = join(tmpDir, "reports");
    mkdirSync(reportsDir, { recursive: true });

    const snapshot: ResearchSnapshot = {
      phase: "done",
      runId: "test-run",
      currentDepth: 1,
      totalDepth: 1,
      allFindings: [],
      allVisitedUrls: [],
      draft: new ResearchDraft("short"),
      reportPath: "",
      searchCalls: 1,
      scrapeCalls: 1,
      startedAt: Date.now(),
      softLimitTriggered: false,
    };

    // Should not throw, just handle gracefully
    const reportPath = assembleReport({
      snapshot,
      topic: "Test",
      reportsDir,
      planArtifactPath: "/tmp/p.json",
      logsDir: join(tmpDir, "logs"),
    });

    assert.ok(existsSync(reportPath), "report file must exist even with short draft");
  });
});
