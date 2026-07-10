import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const ENV_KEYS = {
  reportsDir: "DEEP_RESEARCH_REPORTS_DIR",
  pdfExport: "DEEP_RESEARCH_PDF_EXPORT",
  mindMap: "DEEP_RESEARCH_MIND_MAP",
  reportStyle: "DEEP_RESEARCH_REPORT_STYLE",
  settingsOnSessionStart: "DEEP_RESEARCH_SETTINGS_ON_SESSION_START",
  settingsOnRunStart: "DEEP_RESEARCH_SETTINGS_ON_RUN_START",
  settingsInReport: "DEEP_RESEARCH_SETTINGS_IN_REPORT",
};

describe("SettingsContext — provenance tracking", () => {
  let tmpHome: string;
  let tmpCwd: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `pi-test-home-${Date.now()}-${Math.random()}`);
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    delete process.env.BRAVE_API_KEY;
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  // ─── Source fields exist ──────────────────────────────────
  it("exposes *Source field for each setting", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.ok("reportsDirSource" in ctx);
    assert.ok("artifactsDirSource" in ctx);
    assert.ok("defaultProfileSource" in ctx);
    assert.ok("pdfExportSource" in ctx);
    assert.ok("mindMapSource" in ctx);
    assert.ok("reportStyleSource" in ctx);
    assert.equal(typeof ctx.reportsDirSource, "string");
    assert.equal(typeof ctx.pdfExportSource, "string");
  });

  // ─── Default source = "default" ───────────────────────────
  it("source is 'default' when no file or env set", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.reportsDirSource, "default");
    assert.equal(ctx.pdfExportSource, "default");
    assert.equal(ctx.mindMapSource, "default");
    assert.equal(ctx.reportStyleSource, "default");
    assert.equal(ctx.defaultProfileSource, "default");
  });

  // ─── Env source = "env:VAR_NAME" ──────────────────────────
  it("source is 'env:<VAR>' when env overrides", async () => {
    process.env[ENV_KEYS.pdfExport] = "true";
    process.env[ENV_KEYS.mindMap] = "true";

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.pdfExportSource, "env:DEEP_RESEARCH_PDF_EXPORT");
    assert.equal(ctx.mindMapSource, "env:DEEP_RESEARCH_MIND_MAP");
  });

  // ─── File source from global settings.json ────────────────
  it("source shows file path from global settings.json", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: { pdfExport: true, reportStyle: "subtopics" },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.ok(ctx.pdfExportSource.startsWith("file:"));
    assert.ok(ctx.pdfExportSource.includes(".pi/agent/settings.json"));
  });

  // ─── File source from local settings.json ─────────────────
  it("source shows local file when local overrides global", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: { mindMap: true },
      }),
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: { mindMap: false },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    // Local wins, so source should be the local file
    assert.ok(ctx.mindMapSource.includes(".pi/settings.json"));
    assert.ok(!ctx.mindMapSource.includes("agent"));
  });

  // ─── Env wins over file, source shows env ────────────────
  it("source shows env even when file also sets same field", async () => {
    process.env[ENV_KEYS.pdfExport] = "1";

    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: { pdfExport: false },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.pdfExport, true); // env value wins
    assert.equal(ctx.pdfExportSource, "env:DEEP_RESEARCH_PDF_EXPORT");
  });

  // ─── Raw values unchanged for consumers ──────────────────
  it("raw values unchanged — consumers need no changes", async () => {
    process.env[ENV_KEYS.pdfExport] = "true";

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    // Raw values still work as before
    assert.equal(typeof ctx.reportsDir, "string");
    assert.equal(typeof ctx.pdfExport, "boolean");
    assert.equal(typeof ctx.mindMap, "boolean");
    assert.equal(typeof ctx.reportStyle, "string");
    assert.equal(typeof ctx.profiles, "object");
  });
});

describe("SettingsContext — settingsReport group", () => {
  let tmpHome: string;
  let tmpCwd: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `pi-test-home-${Date.now()}-${Math.random()}`);
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  // ─── settingsReport exists with all three fields ──────────
  it("exposes settingsReport with onSessionStart, onRunStart, inReport", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.ok(ctx.settingsReport);
    assert.equal(typeof ctx.settingsReport.onSessionStart, "boolean");
    assert.equal(typeof ctx.settingsReport.onRunStart, "boolean");
    assert.equal(typeof ctx.settingsReport.inReport, "boolean");
  });

  // ─── All default to false ─────────────────────────────────
  it("defaults all settingsReport fields to false", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.settingsReport.onSessionStart, false);
    assert.equal(ctx.settingsReport.onRunStart, false);
    assert.equal(ctx.settingsReport.inReport, false);
  });

  // ─── Env overrides ───────────────────────────────────────
  it("env vars override settingsReport defaults", async () => {
    process.env[ENV_KEYS.settingsOnSessionStart] = "true";
    process.env[ENV_KEYS.settingsInReport] = "1";

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.settingsReport.onSessionStart, true);
    assert.equal(ctx.settingsReport.onRunStart, false); // not set
    assert.equal(ctx.settingsReport.inReport, true);
  });

  // ─── File overrides ──────────────────────────────────────
  it("settings.json overrides settingsReport defaults", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: {
          settingsReport: { onSessionStart: true, inReport: true },
        },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.settingsReport.onSessionStart, true);
    assert.equal(ctx.settingsReport.onRunStart, false);
    assert.equal(ctx.settingsReport.inReport, true);
  });

  // ─── Local overrides global for settingsReport ───────────
  it("local settings.json overrides global for settingsReport", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: {
          settingsReport: { onSessionStart: true, inReport: false },
        },
      }),
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: {
          settingsReport: { inReport: true },
        },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.settingsReport.onSessionStart, true); // from global
    assert.equal(ctx.settingsReport.inReport, true); // from local (overrides global false)
  });

  // ─── Env wins over file ──────────────────────────────────
  it("env overrides settings.json for settingsReport", async () => {
    process.env[ENV_KEYS.settingsOnSessionStart] = "true";

    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: {
          settingsReport: { onSessionStart: false },
        },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.settingsReport.onSessionStart, true);
  });

  // ─── Source tracking for settingsReport fields ───────────
  it("exposes source fields for settingsReport sub-fields", async () => {
    process.env[ENV_KEYS.settingsOnSessionStart] = "true";

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.ok("settingsReportOnSessionStartSource" in ctx);
    assert.ok("settingsReportOnRunStartSource" in ctx);
    assert.ok("settingsReportInReportSource" in ctx);
    assert.equal(ctx.settingsReportOnSessionStartSource, "env:DEEP_RESEARCH_SETTINGS_ON_SESSION_START");
    assert.equal(ctx.settingsReportOnRunStartSource, "default");
  });
});

describe("SettingsContext — getAllWithSources convenience method", () => {
  let tmpHome: string;
  let tmpCwd: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `pi-test-home-${Date.now()}-${Math.random()}`);
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("returns array of { key, value, source } objects", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    const entries = ctx.getAllWithSources();
    assert.ok(Array.isArray(entries));
    assert.ok(entries.length > 5);
    const reportsEntry = entries.find(e => e.key === "reportsDir");
    assert.ok(reportsEntry);
    assert.ok("value" in reportsEntry);
    assert.ok("source" in reportsEntry);
    assert.equal(typeof reportsEntry!.value, "string");
    assert.equal(typeof reportsEntry!.source, "string");
  });

  it("does not include profiles in the flat list", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    const entries = ctx.getAllWithSources();
    // Profiles are not in the flat list — no entry keyed as a profile name
    const profileKeys = new Set(entries.map(e => e.key));
    assert.ok(!profileKeys.has("default"));
    assert.ok(!profileKeys.has("fast"));
    assert.ok(!profileKeys.has("deep"));
  });

  it("includes credentials with masked values", async () => {
    process.env.BRAVE_API_KEY = "secret";
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    const entries = ctx.getAllWithSources();
    const brave = entries.find(e => e.key === "brave.apiKey");
    assert.ok(brave);
    assert.equal(brave!.value, "****");
    assert.equal(brave!.source, "env:BRAVE_API_KEY");
  });
});
