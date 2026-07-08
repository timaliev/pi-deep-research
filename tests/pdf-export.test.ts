import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Settings: pdfExport ─────────────────────────────────────
describe("pdfExport setting", () => {
  let tmpHome: string;
  let tmpCwd: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `pi-test-home-${Date.now()}-${Math.random()}`);
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    delete process.env.DEEP_RESEARCH_PDF_EXPORT;
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    delete process.env.DEEP_RESEARCH_PDF_EXPORT;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("defaults to false when no settings or env", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.pdfExport, false);
  });

  it("reads from global settings", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ deepResearch: { pdfExport: true } }),
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.pdfExport, true);
  });

  it("local settings override global", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ deepResearch: { pdfExport: true } }),
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({ deepResearch: { pdfExport: false } }),
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.pdfExport, false);
  });

  it("env DEEP_RESEARCH_PDF_EXPORT overrides all", async () => {
    process.env.DEEP_RESEARCH_PDF_EXPORT = "true";
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({ deepResearch: { pdfExport: false } }),
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.pdfExport, true);
  });

  it("env value '1' is truthy", async () => {
    process.env.DEEP_RESEARCH_PDF_EXPORT = "1";
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.pdfExport, true);
  });
});

// ─── PDF conversion: export-pdf module ──────────────────────
describe("convertToPdf", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pdf-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns error when report_path does not exist", async () => {
    const { convertToPdf } = await import("../extension/export-pdf.js");
    const result = await convertToPdf({
      reportPath: join(tmpDir, "nonexistent.md"),
    });
    assert.equal(result.kind, "error");
    assert.ok(result.error?.includes("not found"));
  });

  it("defaults output_path to .pdf when not provided", async () => {
    const reportPath = join(tmpDir, "report.md");
    writeFileSync(reportPath, "# Test report");

    // The module checks for pandoc; when missing, falls back
    const { convertToPdf } = await import("../extension/export-pdf.js");
    const result = await convertToPdf({ reportPath });

    // Fallback or pandoc — both must set output_path
    assert.ok(result.outputPath, "must have output_path");
    assert.ok(result.outputPath.endsWith(".pdf"), "output_path must end with .pdf");
  });

  it("uses explicit output_path when provided", async () => {
    const reportPath = join(tmpDir, "report.md");
    const explicitPdf = join(tmpDir, "custom.pdf");
    writeFileSync(reportPath, "# Test report");

    const { convertToPdf } = await import("../extension/export-pdf.js");
    const result = await convertToPdf({
      reportPath,
      outputPath: explicitPdf,
    });

    assert.equal(result.outputPath, explicitPdf);
  });
});
