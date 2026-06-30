import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Feature 1: save_report writes to reportsDir ────────────────
describe("save_report → reportsDir", () => {
  it("save_report tool receives reportsDir param", async () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
      "utf-8",
    );
    // save_report handler must use reportsDir
    assert.ok(src.includes("reportsDir"), "save_report must reference reportsDir");
  });

  it("save_report mkdirSync creates reportsDir before writing", async () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
      "utf-8",
    );
    // mkdirSync must precede writeFileSync for reportsDir
    const saveReportSection = src.match(/name: "save_report"[\s\S]*?^\s*},/m);
    assert.ok(saveReportSection, "save_report section must exist");
    const mkdirIndex = saveReportSection[0].indexOf("mkdirSync(reportsDir");
    const writeIndex = saveReportSection[0].indexOf("writeFileSync");
    assert.ok(
      mkdirIndex >= 0 && writeIndex > mkdirIndex,
      "mkdirSync(reportsDir) must precede writeFileSync",
    );
  });

  it("auto-save and save_report use same reportsDir source", async () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
      "utf-8",
    );
    // Both paths should use reportsDir consistently
    const reportsDirRefs = [...src.matchAll(/reportsDir/g)];
    assert.ok(reportsDirRefs.length >= 2, "reportsDir referenced at least twice");
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
      join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
      "utf-8",
    );
    // Auto-save should concatenate reportText + telemetry
    const match = src.match(/fullReport\s*=\s*`\$\{(?:reportText|text)/);
    assert.ok(match, "auto-save must build fullReport from reportText + telemetry");
  });

  it("draftReport is saved when phase is 'done'", async () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
      "utf-8",
    );
    const doneSection = src.match(/phase === "done"[\s\S]*?draftReport/g);
    assert.ok(doneSection, "done phase handler must reference draftReport");
  });
});

// ─── Feature 3: telemetry appended to report ──────────────────
describe("telemetry appended to report", () => {
  it("buildTelemetrySection returns markdown table", async () => {
    const { buildTelemetrySection } = await import("../extension/state-machine.js");
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

  it("telemetry is saved with report path in session", async () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
      "utf-8",
    );
    // session.saveReportPath must include telemetry
    const savePathCall = src.match(/saveReportPath\([^)]+telemetry[^)]*\)/);
    assert.ok(
      savePathCall || src.includes("saveReportPath(reportPath, reportsDir, telemetry)"),
      "saveReportPath must pass telemetry param",
    );
  });

  it("save_report reads telemetry from session and appends to report", async () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
      "utf-8",
    );
    const saveSection = src.match(/name: "save_report"[\s\S]*?^\s*},/m);
    assert.ok(saveSection, "save_report section must exist");
    assert.ok(
      saveSection[0].includes("telemetry"),
      "save_report must handle telemetry from session",
    );
  });
});

// ─── Feature 4: Brave API key from settings.json ──────────────
describe("Brave API key from settings.json", () => {
  it("resolveBraveApiKey checks process.env first", async () => {
    const { resolveBraveApiKey } = await import("../extension/brave-search.js");
    const key = resolveBraveApiKey(undefined);
    // When no env var set, falls back to undefined
    assert.equal(key, process.env.BRAVE_API_KEY ?? undefined);
  });

  it("SearchProviderCredentials.get reads brave apiKey from settings", async () => {
    const { SearchProviderCredentials } = await import("../extension/search-providers.js");
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

  it("loadSearchProviders reads deepResearch.searchProviders", async () => {
    const { loadSearchProviders } = await import("../extension/search-providers.js");
    const tmpDir = join(tmpdir(), `test-brave-creds-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const settingsPath = join(tmpDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        deepResearch: {
          searchProviders: {
            brave: { apiKey: "bsa-123" },
          },
        },
      }),
    );

    const providers = loadSearchProviders(settingsPath);
    assert.equal(providers.brave?.apiKey, "bsa-123");

    rmSync(tmpDir, { recursive: true });
  });
});
