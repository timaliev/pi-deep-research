/**
 * ADR-0026: Multi-step TUI confirmation dialog.
 * Tests confirmPlanDialog flow with mocked ctx.ui.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

describe("ADR-0026 — Multi-step confirmation dialog", () => {
  let tmpDir: string;
  let planPath: string;

  function makePlan(overrides: Record<string, unknown> = {}) {
    return {
      topic: "test",
      goal: "test goal",
      researchQuestions: ["q1", "q2"],
      engines: ["duckduckgo"],
      profile: { name: "default" as const },
      scope: { include: "", exclude: "" },
      estimatedCost: { searchCalls: 6, scrapeCalls: 4, description: "~6 searches" },
      ...overrides,
    };
  }

  function makeMockCtx(selectResponses: string[], hasUI = true) {
    let callIndex = 0;
    return {
      hasUI,
      ui: {
        select: async (_title: string, _options: string[]) => {
          const response = selectResponses[callIndex] ?? selectResponses[selectResponses.length - 1];
          callIndex++;
          return response;
        },
        input: async (_title: string, _default?: string) => _default ?? "",
      },
      sessionManager: {
        getEntries: () => [] as Array<{ customType?: string; data?: unknown }>,
      },
    };
  }

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `pi-test-dialog-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    planPath = join(tmpDir, "prefilter.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        version: 1,
        runId: "test",
        createdAt: new Date().toISOString(),
        inputTopic: "test",
        plan: makePlan(),
      }),
      "utf-8",
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns confirmed:true when already confirmed (idempotent)", async () => {
    const { confirmPlanDialog } = await import("../extension/confirm-dialog.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");
    const { SettingsContext } = await import("../extension/settings-context.js");
    const { SessionState } = await import("../extension/session-state.js");

    const settings = SettingsContext.init({ cwd: tmpDir });
    const resolver = new ProfileResolver({});

    // Pre-confirm: write confirmation marker
    const writer = { entries: [] as Array<{ customType: string; data: unknown }> };
    const session = new SessionState({
      appendEntry(customType: string, data?: unknown) {
        writer.entries.push({ customType, data });
      },
    });
    session.saveConfirmation(planPath);

    const ctx = {
      hasUI: true,
      ui: { select: async () => assert.fail("should not show dialog"), input: async () => "" },
      sessionManager: { getEntries: () => writer.entries },
    };

    const result = await confirmPlanDialog(ctx as any, makePlan(), resolver, settings, planPath);
    assert.ok(result.confirmed, "already confirmed must return confirmed:true");
    assert.ok(!result.cancelled);
  });

  it("returns cancelled:true and deletes plan file when user picks Cancel", async () => {
    const { confirmPlanDialog } = await import("../extension/confirm-dialog.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");
    const { SettingsContext } = await import("../extension/settings-context.js");

    const settings = SettingsContext.init({ cwd: tmpDir });
    const resolver = new ProfileResolver({});
    const ctx = makeMockCtx(["❌ Cancel — Discard plan"]);

    const { existsSync } = await import("node:fs");
    assert.ok(existsSync(planPath), "plan file must exist before dialog");

    const result = await confirmPlanDialog(ctx as any, makePlan(), resolver, settings, planPath);
    assert.ok(result.cancelled, "Cancel must return cancelled:true");
    assert.ok(!result.confirmed);
    assert.ok(!existsSync(planPath), "plan file must be deleted after cancel");
  });

  it("returns confirmed:true when user picks Confirm", async () => {
    const { confirmPlanDialog } = await import("../extension/confirm-dialog.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");
    const { SettingsContext } = await import("../extension/settings-context.js");

    const settings = SettingsContext.init({ cwd: tmpDir });
    const resolver = new ProfileResolver({});
    const ctx = makeMockCtx(["✅ Confirm — Start research"]);

    const result = await confirmPlanDialog(ctx as any, makePlan(), resolver, settings, planPath);
    assert.ok(result.confirmed, "Confirm must return confirmed:true");
    assert.ok(!result.cancelled);
  });

  it("returns confirmed:false, cancelled:false in non-interactive mode", async () => {
    const { confirmPlanDialog } = await import("../extension/confirm-dialog.js");
    const { ProfileResolver } = await import("../extension/profile-resolver.js");
    const { SettingsContext } = await import("../extension/settings-context.js");

    const settings = SettingsContext.init({ cwd: tmpDir });
    const resolver = new ProfileResolver({});
    const ctx = makeMockCtx([], false);

    const result = await confirmPlanDialog(ctx as any, makePlan(), resolver, settings, planPath);
    assert.ok(!result.confirmed && !result.cancelled, "non-interactive must return both false");
  });
});
