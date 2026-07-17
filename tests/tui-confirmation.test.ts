/**
 * TUI confirmation flow: plan_research handles confirmation inline via confirmPlanDialog.
 * No separate confirm_research tool or tool_call interceptor — flow is:
 *   plan_research → confirmPlanDialog → saveConfirmation → run_research (defensive gate checks key)
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const planResearchSrc = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "tools", "plan-research.ts"),
  "utf-8",
);
const runResearchSrc = readFileSync(
  join(import.meta.dirname ?? ".", "..", "extension", "tools", "run-research.ts"),
  "utf-8",
);
const depsSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "tools", "deps.ts"), "utf-8");
const indexSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "index.ts"), "utf-8");
const dialogSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "confirm-dialog.ts"), "utf-8");
const confirmPlanPath = join(import.meta.dirname ?? ".", "..", "extension", "tools", "confirm-plan.ts");

describe("TUI confirmation flow", () => {
  it("plan_research calls confirmPlanDialog directly", () => {
    assert.ok(planResearchSrc.includes("confirmPlanDialog"), "plan_research must call confirmPlanDialog");
  });

  it("run_research has defensive confirmation gate via CONFIRMATION_KEY", () => {
    assert.ok(runResearchSrc.includes("CONFIRMATION_KEY"), "run_research must check confirmation marker");
  });

  it("deps.ts does not register confirm_research tool", () => {
    assert.ok(!depsSrc.includes("confirm-plan"), "deps.ts must not import confirm-plan module");
    assert.ok(!depsSrc.includes("ConfirmPlan"), "deps.ts must not reference ConfirmPlan");
  });

  it("index.ts does not intercept confirm_research tool_call", () => {
    assert.ok(!indexSrc.includes("confirm_research"), "index.ts must not reference confirm_research");
  });

  it("confirm-plan.ts tool file does not exist", () => {
    assert.ok(!existsSync(confirmPlanPath), "confirm-plan.ts must be deleted");
  });

  it("confirm-dialog.ts checks hasUI for non-interactive detection", () => {
    assert.ok(dialogSrc.includes("hasUI"), "confirm-dialog.ts must check ctx.hasUI");
  });

  it("confirm-dialog.ts skips dialog when already confirmed", () => {
    assert.ok(dialogSrc.includes("alreadyConfirmed"), "must check for existing confirmation before showing dialog");
  });

  it("confirm-dialog.ts handles cancel by deleting plan file", () => {
    assert.ok(dialogSrc.includes("unlinkSync"), "must delete plan artifact on cancel");
  });
});
