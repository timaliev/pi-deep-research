import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const ENV_KEYS = {
  reportsDir: "DEEP_RESEARCH_REPORTS_DIR",
  artifactsDir: "DEEP_RESEARCH_ARTIFACTS_DIR",
  defaultProfile: "DEEP_RESEARCH_DEFAULT_PROFILE",
  pdfExport: "DEEP_RESEARCH_PDF_EXPORT",
  mindMap: "DEEP_RESEARCH_MIND_MAP",
  reportStyle: "DEEP_RESEARCH_REPORT_STYLE",
  settingsOnSessionStart: "DEEP_RESEARCH_SETTINGS_ON_SESSION_START",
  settingsOnRunStart: "DEEP_RESEARCH_SETTINGS_ON_RUN_START",
  settingsInReport: "DEEP_RESEARCH_SETTINGS_IN_REPORT",
};

describe("SettingsReporter — buildSettingsTable", () => {
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

  it("returns a markdown table with Setting, Value, Source columns", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes("| Setting | Value | Source |"));
    assert.ok(table.includes("| reportsDir |"));
    assert.ok(table.includes("| pdfExport |"));
    assert.ok(table.includes("| mindMap |"));
    assert.ok(table.includes("| reportStyle |"));
    assert.ok(table.includes("| settingsReport.onSessionStart |"));
  });

  it("shows 'default' for settings using built-in value", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes("| default |"));
  });

  it("shows env:DEEP_RESEARCH_PDF_EXPORT when env overrides", async () => {
    process.env[ENV_KEYS.pdfExport] = "true";
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes("| env:DEEP_RESEARCH_PDF_EXPORT |"));
  });

  it("shows file:~/... for settings from global settings.json", async () => {
    const { homedir } = await import("node:os");
    const homeDir = homedir();
    const realAgentDir = join(homeDir, ".pi-test-sr", "agent");
    mkdirSync(realAgentDir, { recursive: true });
    writeFileSync(join(realAgentDir, "settings.json"), JSON.stringify({ deepResearch: { pdfExport: true } }));
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: realAgentDir });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes("file:~/.pi-test-sr/agent/settings.json"));
    rmSync(join(homeDir, ".pi-test-sr"), { recursive: true, force: true });
  });

  it("masks API key values as **** but shows source", async () => {
    process.env.BRAVE_API_KEY = "secret-key";
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes("| brave.apiKey | **** | env:BRAVE_API_KEY |"));
  });

  it("includes a Profiles section with built-in presets", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes("### Profiles"));
    assert.ok(table.includes("| default |"));
    assert.ok(table.includes("| fast |"));
    assert.ok(table.includes("| deep |"));
  });

  it("shows '-' for undefined optional profile fields", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    // default profile has no maxSearchCalls/maxElapsedSeconds → shows "-"
    assert.ok(table.includes("| default | 4 | 2 | 4 | - | - |"));
  });

  it("shows custom profile with user-defined values", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ deepResearch: { profiles: { custom: { breadth: 10, maxSearchCalls: 100 } } } }),
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes("| custom | 10 |"));
    assert.ok(table.includes("| 100 |")); // maxSearchCalls
  });

  it("includes System section with Node.js, platform, cwd", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes("### System"));
    assert.ok(table.includes("Node.js"));
    assert.ok(table.includes("Platform"));
    assert.ok(table.includes("CWD"));
    assert.ok(table.includes(process.version), "must include Node.js version");
    assert.ok(table.includes(process.platform), "must include platform");
    assert.ok(table.includes(process.arch), "must include architecture");
  });

  it("System section includes OS release and hostname", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsTable } = await import("../extension/settings-reporter.js");
    const { hostname } = await import("node:os");

    const table = buildSettingsTable(ctx);
    assert.ok(table.includes(hostname()), "must include hostname");
  });
});

describe("SettingsReporter — buildSettingsJson", () => {
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

  it("returns structured object with settings and profiles", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsJson } = await import("../extension/settings-reporter.js");

    const json = buildSettingsJson(ctx) as any;
    assert.ok(json.settings);
    assert.ok(json.profiles);
    assert.ok(json.settings.reportsDir);
  });

  it("each setting entry has value and source", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsJson } = await import("../extension/settings-reporter.js");

    const json = buildSettingsJson(ctx) as any;
    const entry = json.settings.reportsDir;
    assert.ok("value" in entry);
    assert.ok("source" in entry);
  });

  it("credentials masked in JSON too", async () => {
    process.env.BRAVE_API_KEY = "secret-key";
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { buildSettingsJson } = await import("../extension/settings-reporter.js");

    const json = buildSettingsJson(ctx) as any;
    assert.equal(json.settings["brave.apiKey"].value, "****");
    assert.equal(json.settings["brave.apiKey"].source, "env:BRAVE_API_KEY");
  });
});

describe("SettingsReporter — writeSettingsLog", () => {
  let tmpHome: string;
  let tmpCwd: string;
  let tmpLogDir: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `pi-test-home-${Date.now()}-${Math.random()}`);
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    tmpLogDir = join(tmpdir(), `pi-test-logs-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    mkdirSync(tmpLogDir, { recursive: true });
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
    rmSync(tmpLogDir, { recursive: true, force: true });
  });

  it("writes JSON file to log directory for session_start trigger", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { writeSettingsLog } = await import("../extension/settings-reporter.js");

    writeSettingsLog(ctx, tmpLogDir, { trigger: "session_start" });
    const files = readdirSync(tmpLogDir);
    assert.ok(files.some((f) => f.startsWith("session-settings-") && f.endsWith(".json")));
  });

  it("writes JSON file with runId for run_start trigger", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { writeSettingsLog } = await import("../extension/settings-reporter.js");

    writeSettingsLog(ctx, tmpLogDir, { trigger: "run_start", runId: "20260710-test" });
    const files = readdirSync(tmpLogDir);
    const runFile = files.find((f) => f.startsWith("20260710-test-settings") && f.endsWith(".json"));
    assert.ok(runFile, "must find runId-prefixed settings file");
    // Verify runId is in the JSON content, not null
    const raw = readFileSync(join(tmpLogDir, runFile!), "utf-8");
    const json = JSON.parse(raw);
    assert.equal(json.runId, "20260710-test", "runId must be in JSON content");
    // Verify no timestamp in filename when runId present
    assert.ok(!runFile!.includes("T"), "filename must not contain timestamp when runId present");
  });

  it("writes session_start log only once per process", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const { writeSettingsLog, _resetSessionStartFlag } = await import("../extension/settings-reporter.js");

    _resetSessionStartFlag();

    writeSettingsLog(ctx, tmpLogDir, { trigger: "session_start" });
    const afterFirst = readdirSync(tmpLogDir).filter((f) => f.startsWith("session-settings-")).length;
    assert.equal(afterFirst, 1, "first call must write 1 file");

    writeSettingsLog(ctx, tmpLogDir, { trigger: "session_start" });
    writeSettingsLog(ctx, tmpLogDir, { trigger: "session_start" });
    const afterAll = readdirSync(tmpLogDir).filter((f) => f.startsWith("session-settings-")).length;
    assert.equal(afterAll, 1, "subsequent calls must not write additional files");
  });
});
