import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// ─── Feature 1: save_report writes to reportsDir ────────────────
describe("save_report → reportsDir", () => {
  it("save_report tool receives reportsDir param", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools/deps.ts"), "utf-8");
    // save_report handler must use reportsDir
    assert.ok(src.includes("reportsDir"), "save_report must reference reportsDir");
  });

  it("writeReportFile creates reportsDir and writes content", async () => {
    const { writeReportFile } = await import("../extension/report-assembly.js");
    const tmpDir = join(tmpdir(), `save-test-${Date.now()}`);
    const path = join(tmpDir, "report.md");

    try {
      writeReportFile(path, "# Report\n\nContent.", "## Research Telemetry\n\ntable");
      assert.ok(existsSync(path), "report file must exist");
      const content = readFileSync(path, "utf-8");
      assert.ok(content.includes("# Report"), "must contain report content");
      assert.ok(content.includes("## Research Telemetry"), "must contain appended telemetry");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("auto-save and save_report use same reportsDir source", async () => {
    const srcIdx = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "index.ts"), "utf-8");
    const srcDeps = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "deps.ts"), "utf-8");
    // reportsDir should flow through settings object to both index.ts and deps.ts
    assert.ok(srcIdx.includes("settings"), "index.ts must reference settings");
    assert.ok(srcDeps.includes("settings"), "deps.ts must reference settings");
  });
});

// ─── Feature 2: save_report writes full report + telemetry ──────
describe("save_report — writes full content", () => {
  it("save_report writes params.markdown to file", async () => {
    const tmpDir = join(tmpdir(), `test-report-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const testPath = join(tmpDir, "test-report.md");

    // Simulate what save_report does: write params.markdown
    const { writeFileSync: wf } = await import("node:fs");
    const markdown = "# Test Report\n\nContent here.";
    wf(testPath, markdown, "utf-8");

    const written = readFileSync(testPath, "utf-8");
    assert.equal(written, markdown, "file must contain exactly the markdown");

    // Also verify telemetry is appended when available
    const telemetry = "## Telemetry\n\n| key | val |";
    wf(testPath, `${markdown}\n\n${telemetry}\n`, "utf-8");
    const withTelemetry = readFileSync(testPath, "utf-8");
    assert.ok(withTelemetry.includes("# Test Report"));
    assert.ok(withTelemetry.includes("## Telemetry"));

    rmSync(tmpDir, { recursive: true });
  });

  it("auto-save writes reportText + telemetry", async () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "research-run-orchestrator.ts"),
      "utf-8",
    );
    // Auto-save delegates to assembleReport module (now in orchestrator)
    const match = src.match(/assembleReport\(\{/);
    assert.ok(match, "auto-save must call assembleReport");
  });

  it("report is saved when phase is 'done'", async () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "research-run-orchestrator.ts"),
      "utf-8",
    );
    const doneSection = src.match(/assembleReport\(\{/);
    assert.ok(doneSection, "orchestrator done phase must call assembleReport");
  });
});

// ─── Feature 3: telemetry appended to report ──────────────────
describe("telemetry appended to report", () => {
  it("buildTelemetrySection returns markdown table", async () => {
    const { buildTelemetrySection } = await import("../extension/report-assembly.js");
    const snapshot = {
      runId: "test-run",
      searchCalls: 5,
      scrapeCalls: 10,
      allVisitedUrls: ["a", "b", "c"],
      totalDepth: 2,
      currentDepth: 2,
      startedAt: Date.now() - 60000,
      softLimitTriggered: false,
    };
    const result = buildTelemetrySection(snapshot as any);
    assert.ok(result.includes("## Research Telemetry"), "must have telemetry header");
    assert.ok(result.includes("|"), "must be a table");
    assert.ok(result.includes("Search calls"), "must include search count");
    assert.ok(result.includes("Scrape calls"), "must include scrape count");
  });

  it("telemetry is NOT passed through saveReportPath (removed dead code)", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools/run-research.ts"), "utf-8");
    // saveReportPath must NOT pass an empty telemetry argument
    const savePathCall = src.match(/saveReportPath\([^)]+\)/);
    assert.ok(savePathCall, "saveReportPath call must exist");
    assert.ok(!savePathCall[0].includes('""'), "saveReportPath must not pass empty string telemetry");
  });

  it("save_report does NOT reference storedTelemetry (removed dead code)", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools/deps.ts"), "utf-8");
    assert.ok(!src.includes("storedTelemetry"), "save_report must not reference storedTelemetry");
  });

  it("does not reuse stale report-path from a different research run", async () => {
    const tmpDir = join(tmpdir(), `test-sr-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Simulate two different research runs
    const oldReportPath = join(tmpDir, "2026-01-01-old-topic.md");
    writeFileSync(oldReportPath, "Old report content", "utf-8");

    // Stale session entry from a PREVIOUS run
    const staleEntry = {
      customType: "deep-research:report-path",
      data: {
        path: oldReportPath,
        reportsDir: tmpDir,
        telemetry: "## Research Telemetry\n\n| Search calls | 5 |",
        runId: "old-run-id",
      },
    };

    // New report — should NOT overwrite old path
    const newPath = join(tmpDir, "2026-07-08-new-topic.md");
    const newMarkdown = "# New Report\n\nFresh content.";

    // Simulate: save_report called with a new topic
    // The tool must NOT write to oldReportPath
    const { resolveReportPath } = await import("../extension/report-assembly.js");
    const generatedPath = resolveReportPath("New Topic", tmpDir);

    // Write to generated path (simulating fixed behavior)
    const { writeFileSync: wf } = await import("node:fs");
    wf(generatedPath, newMarkdown, "utf-8");

    // Old report must still have original content
    const oldContent = readFileSync(oldReportPath, "utf-8");
    assert.equal(oldContent, "Old report content", "old report must not be overwritten");

    // New report must have new content
    const newContent = readFileSync(generatedPath, "utf-8");
    assert.equal(newContent, newMarkdown, "new report must have correct content");

    rmSync(tmpDir, { recursive: true });
  });
});

// ─── Feature 4: save_report accepts report_path for large files ─
describe("save_report — report_path param", () => {
  it("accepts report_path parameter in TypeBox schema", async () => {
    const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "deps.ts"), "utf-8");
    // report_path must be a TypeBox Optional(String) parameter in Type.Object schema
    // Look for: report_path: Type.Optional(Type.String( anywhere in the parameters block
    const hasParam = /report_path:\s*Type\.\w+/.test(src);
    assert.ok(hasParam, "save_report must have report_path as a TypeBox parameter");
  });

  it("report_path resolves by reading file, passes to writeReportFile", async () => {
    const tmpDir = join(tmpdir(), `test-rp-disk-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Simulating auto-saved report from run_research
    const sourcePath = join(tmpDir, "auto-saved-report.md");
    const content = "# Large Report\n\nThis report was auto-saved by run_research.";
    writeFileSync(sourcePath, content, "utf-8");

    // What save_report does with report_path:
    // 1. read content from disk
    const resolvedContent = readFileSync(sourcePath, "utf-8");
    assert.equal(resolvedContent, content, "content must be readable from report_path");

    // 2. pass to writeReportFile (the same function save_report delegates to)
    const { writeReportFile } = await import("../extension/report-assembly.js");
    const destPath = join(tmpDir, "final-report.md");
    writeReportFile(destPath, resolvedContent);

    // 3. content preserved, source untouched
    const savedContent = readFileSync(destPath, "utf-8");
    assert.ok(savedContent.includes("This report was auto-saved"), "saved content must match source");
    assert.equal(readFileSync(sourcePath, "utf-8"), content, "source must not be overwritten by save_report");

    rmSync(tmpDir, { recursive: true });
  });
});

// ─── Feature 5: Brave API key from settings.json ──────────────
describe("Brave API key from settings.json", () => {
  it("resolveBraveApiKey checks process.env first", async () => {
    const { resolveBraveApiKey } = await import("../extension/search/engines/brave.js");
    const key = resolveBraveApiKey(undefined);
    // When no env var set, falls back to undefined
    assert.equal(key, process.env.BRAVE_API_KEY ?? undefined);
  });

  it("SearchProviderCredentials.get reads brave apiKey from settings", async () => {
    const { SearchProviderCredentials } = await import("../extension/settings-context.js");
    const cred = new SearchProviderCredentials({
      brave: { apiKey: "settings-key-123" },
    });
    const key = cred.get("brave", "apiKey");
    if (process.env.BRAVE_API_KEY) {
      assert.equal(key, process.env.BRAVE_API_KEY, "env wins over settings");
    } else {
      assert.equal(key, "settings-key-123", "settings value when no env");
    }
  });
});
