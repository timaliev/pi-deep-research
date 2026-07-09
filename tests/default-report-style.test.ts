import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("defaultReportStyle setting", () => {
  let tmpHome: string;
  let tmpCwd: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `pi-test-home-${Date.now()}-${Math.random()}`);
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    delete process.env.DEEP_RESEARCH_REPORT_STYLE;
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    delete process.env.DEEP_RESEARCH_REPORT_STYLE;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("defaults to narrative when no settings or env", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.reportStyle, "narrative");
  });

  it("reads from global settings", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ deepResearch: { defaultReportStyle: "subtopics" } }),
      "utf-8",
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.reportStyle, "subtopics");
  });

  it("local settings override global", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ deepResearch: { defaultReportStyle: "subtopics" } }),
      "utf-8",
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({ deepResearch: { defaultReportStyle: "narrative" } }),
      "utf-8",
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.reportStyle, "narrative");
  });

  it("env DEEP_RESEARCH_REPORT_STYLE overrides all", async () => {
    process.env.DEEP_RESEARCH_REPORT_STYLE = "subtopics";
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ deepResearch: { defaultReportStyle: "narrative" } }),
      "utf-8",
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({ deepResearch: { defaultReportStyle: "narrative" } }),
      "utf-8",
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.reportStyle, "subtopics");
  });

  it("rejects invalid values, falls back to narrative", async () => {
    process.env.DEEP_RESEARCH_REPORT_STYLE = "invalid";
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.reportStyle, "narrative");
  });
});
