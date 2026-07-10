import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const ENV_KEYS = {
  settingsInReport: "DEEP_RESEARCH_SETTINGS_IN_REPORT",
};

describe("Orchestrator — settings section in report", () => {
  let tmpCwd: string;

  beforeEach(async () => {
    const { tmpdir } = await import("node:os");
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    delete process.env[ENV_KEYS.settingsInReport];
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    delete process.env[ENV_KEYS.settingsInReport];
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("appendSettingsSection includes ## Settings with table", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const settings = SettingsContext.init({
      cwd: tmpCwd,
      homeAgentDir: join(tmpCwd, ".pi", "agent"),
    });
    const { appendSettingsSection } = await import("../extension/settings-reporter.js");

    const report = "## Introduction\n\nSome content.\n\n## Telemetry\n\n| Metric | Value |\n|---|---|\n";
    const result = appendSettingsSection(report, settings);

    assert.ok(result.includes("## Settings"));
    assert.ok(result.includes("| Setting | Value | Source |"));
    // Settings section comes after Telemetry
    const telemetryIdx = result.indexOf("## Telemetry");
    const settingsIdx = result.indexOf("## Settings");
    assert.ok(settingsIdx > telemetryIdx, "Settings section should come after Telemetry");
  });

  it("appendSettingsSection contains profiles table", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const settings = SettingsContext.init({
      cwd: tmpCwd,
      homeAgentDir: join(tmpCwd, ".pi", "agent"),
    });
    const { appendSettingsSection } = await import("../extension/settings-reporter.js");

    const report = "## Telemetry\n\n...\n";
    const result = appendSettingsSection(report, settings);

    assert.ok(result.includes("### Profiles"));
    assert.ok(result.includes("| default |"));
  });
});
