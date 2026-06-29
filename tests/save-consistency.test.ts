import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { topicToSlug } from "../extension/slug.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-save-consistency");

const REPORT_PATH_KEY = "deep-research:report-path";

describe("save_report and auto-save path consistency", () => {
  beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("auto-save stores reportsDir in session state", () => {
    const reportsDir = join(TEST_DIR, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, "2026-06-29-test.md");

    const stateEntry = buildReportPathEntry(reportPath, reportsDir, "## Telemetry\n...");
    assert.equal(stateEntry.data.path, reportPath);
    assert.equal(stateEntry.data.reportsDir, reportsDir);
    assert.ok(stateEntry.data.telemetry, "must include telemetry");
  });

  it("save_report resolves path from state when available", () => {
    const storedPath = "/tmp/reports/2026-06-29-test.md";
    const entries = [
      { customType: REPORT_PATH_KEY, data: { path: storedPath } },
    ];

    const resolved = resolveSavePath("эллиптические тренажеры", entries, "/cwd");
    assert.equal(resolved.path, storedPath, "must use stored path");
  });

  it("save_report falls back to ctx.cwd when no state", () => {
    const resolved = resolveSavePath("test topic", [], "/cwd");
    assert.ok(resolved.path.includes("/cwd/deep-research/reports/"));
  });

  it("save_report falls back to stored reportsDir when available", () => {
    const entries = [
      { customType: REPORT_PATH_KEY, data: { reportsDir: "/stored/reports" } },
    ];

    const resolved = resolveSavePath("test", entries, "/cwd");
    assert.ok(resolved.path.includes("/stored/reports/"), "must use stored reportsDir");
  });

  it("save_report appends telemetry from session state", () => {
    const reportPath = join(TEST_DIR, "reports", "test.md");
    mkdirSync(join(TEST_DIR, "reports"), { recursive: true });

    const result = saveReportWithTelemetry(
      "# Report body",
      reportPath,
      "## Research Telemetry\n\n| Run ID | `x` |",
    );

    const content = readFileSync(result.path, "utf-8");
    assert.ok(content.includes("# Report body"));
    assert.ok(content.includes("## Research Telemetry"));
    assert.ok(content.includes("| Run ID |"));
  });

  it("save_report writes without telemetry when none in state", () => {
    const reportPath = join(TEST_DIR, "reports", "test2.md");
    mkdirSync(join(TEST_DIR, "reports"), { recursive: true });

    const result = saveReportWithTelemetry("# Just body", reportPath, undefined);
    const content = readFileSync(result.path, "utf-8");
    assert.equal(content, "# Just body");
  });
});

function buildReportPathEntry(
  reportPath: string, reportsDir: string, telemetry: string,
) {
  return {
    customType: REPORT_PATH_KEY,
    data: { path: reportPath, reportsDir, telemetry },
  };
}

function resolveSavePath(
  paramsTopic: string,
  entries: Array<{ customType?: string; data?: Record<string, unknown> }>,
  cwd: string,
): { path: string } {
  const entry = [...entries].reverse().find((e) => e.customType === REPORT_PATH_KEY);
  if (entry?.data?.path && typeof entry.data.path === "string") {
    return { path: entry.data.path };
  }
  const reportsDir = (entry?.data?.reportsDir as string) || join(cwd, "deep-research", "reports");
  const date = new Date().toISOString().slice(0, 10);
  const slug = topicToSlug(paramsTopic);
  return { path: join(reportsDir, `${date}-${slug}.md`) };
}

function saveReportWithTelemetry(
  markdown: string,
  path: string,
  telemetry?: string,
): { path: string } {
  const content = telemetry ? `${markdown}\n\n${telemetry}\n` : markdown;
  writeFileSync(path, content, "utf-8");
  return { path };
}
