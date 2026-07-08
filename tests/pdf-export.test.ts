import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync as readFs } from "node:fs";
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

// ─── export_pdf tool registration ───────────────────────────
describe("export_pdf tool", () => {
  it("tool is registered in index.ts", async () => {
    const src = readIndexTs();
    assert.ok(src.includes('"export_pdf"'), "index.ts must register export_pdf tool");
  });

  it("tool accepts report_path (required) and output_path (optional)", async () => {
    const src = readIndexTs();
    assert.ok(src.includes("report_path"), "must have report_path param");
    assert.ok(src.includes("output_path"), "must have output_path param");
  });

  it("tool imports convertToPdf from export-pdf module", async () => {
    const src = readIndexTs();
    assert.ok(
      src.includes("export-pdf") || src.includes("convertToPdf"),
      "must import from export-pdf module",
    );
  });

  it("tool calls convertToPdf in execute handler", async () => {
    const src = readIndexTs();
    assert.ok(src.includes("convertToPdf"), "must call convertToPdf");
  });

  it("tool sends fallback injection when pandoc missing", async () => {
    const src = readIndexTs();
    // When convertToPdf returns kind: "fallback", tool must call pi.sendUserMessage
    assert.ok(
      src.includes("sendUserMessage") || src.includes("fallback"),
      "must handle fallback via pi.sendUserMessage",
    );
  });

  it("creates output directory if missing", async () => {
    const { convertToPdf } = await import("../extension/export-pdf.js");
    const tmpDir = join(tmpdir(), `pdf-mkdir-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const nestedDir = join(tmpDir, "sub", "deep");
    const reportPath = join(tmpDir, "report.md");
    const outputPath = join(nestedDir, "out.pdf");

    try {
      writeFileSync(reportPath, "# Report");
      const result = await convertToPdf({ reportPath, outputPath });
      // Directory must be created
      assert.ok(existsSync(nestedDir), "nested output directory must be created");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

/** Read index.ts source for static analysis. */
function readIndexTs(): string {
  return readFs(
    join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
    "utf-8",
  );
}
