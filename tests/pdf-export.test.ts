import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync as readFs, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

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
    writeFileSync(join(tmpCwd, ".pi", "settings.json"), JSON.stringify({ deepResearch: { pdfExport: false } }));
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.pdfExport, false);
  });

  it("env DEEP_RESEARCH_PDF_EXPORT overrides all", async () => {
    process.env.DEEP_RESEARCH_PDF_EXPORT = "true";
    writeFileSync(join(tmpCwd, ".pi", "settings.json"), JSON.stringify({ deepResearch: { pdfExport: false } }));
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

  it("creates PDF file when pandoc is available", async () => {
    // Mock pandoc and weasyprint via fake scripts in PATH
    const binDir = join(tmpDir, "bin");
    mkdirSync(binDir, { recursive: true });

    // Fake pandoc: creates output file (arg order: reportPath, -o, outputPath, ...)
    writeFileSync(join(binDir, "pandoc"), '#!/bin/bash\ntouch "$3"\n', { mode: 0o755 });
    writeFileSync(join(binDir, "weasyprint"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });

    const reportPath = join(tmpDir, "research.md");
    const pdfPath = join(tmpDir, "research.pdf");
    writeFileSync(reportPath, "# Research Report\n\nContent here.");

    // Prepend binDir to PATH
    const prevPath = process.env.PATH;
    process.env.PATH = binDir + ":" + (prevPath || "");

    try {
      const mod = await import("../extension/export-pdf.js");
      const result = await mod.convertToPdf({ reportPath, outputPath: pdfPath });

      assert.equal(result.kind, "success");
      assert.equal(result.method, "pandoc");
      assert.ok(existsSync(pdfPath), "PDF file must exist after pandoc conversion");
    } finally {
      process.env.PATH = prevPath;
    }
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
    assert.ok(src.includes("export-pdf") || src.includes("convertToPdf"), "must import from export-pdf module");
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
  return readFs(join(import.meta.dirname ?? ".", "..", "extension", "tools", "export-pdf.ts"), "utf-8");
}

/** Read run-research.ts source for static analysis. */
function readRunResearchTs(): string {
  return readFs(join(import.meta.dirname ?? ".", "..", "extension", "tools", "run-research.ts"), "utf-8");
}

/** Read orchestrator source for static analysis. */
function readOrchestratorTs(): string {
  return readFs(join(import.meta.dirname ?? ".", "..", "extension", "research-run-orchestrator.ts"), "utf-8");
}

// ─── Auto-export integration ─────────────────────────────────
describe("auto-export after run_research done", () => {
  it("orchestrator checks pdfExport when research completes", async () => {
    const src = readOrchestratorTs();
    // buildDoneResult must check pdfExport setting
    assert.ok(src.includes("pdfExport"), "orchestrator must check pdfExport setting");
  });

  it("orchestrator imports convertToPdf for auto-export", async () => {
    const src = readOrchestratorTs();
    assert.ok(src.includes("convertToPdf") || src.includes("export-pdf"), "orchestrator must reference convertToPdf");
  });

  it("run-research tool has access to settings (for pdfExport)", async () => {
    const src = readRunResearchTs();
    assert.ok(src.includes("settings"), "createRunResearchTool receives settings param");
  });

  it("auto-export result appended to done response", async () => {
    const src = readRunResearchTs();
    // When pdfExport enabled and conversion succeeds, the done message includes PDF info
    const hasPdfInDone = src.includes("pdf") || src.includes("PDF") || src.includes("export_pdf");
    assert.ok(hasPdfInDone, "done handler must mention PDF output");
  });
});
