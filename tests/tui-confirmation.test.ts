/**
 * ADR-0019: TUI confirmation gate for research plans.
 * Intercepts confirm_research tool call and requires user TUI approval.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const indexSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "index.ts"), "utf-8");
const dialogSrc = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "confirm-dialog.ts"), "utf-8");

describe("ADR-0019 — TUI confirmation gate", () => {
  it("index.ts wires tool_call interceptor", () => {
    assert.ok(indexSrc.includes('pi.on("tool_call"'), "index.ts must wire tool_call event interceptor");
  });

  it("interceptor targets confirm_research tool", () => {
    assert.ok(indexSrc.includes("confirm_research"), "interceptor must reference confirm_research");
  });

  it("delegates to shared confirmPlanDialog", () => {
    assert.ok(indexSrc.includes("confirmPlanDialog"), "index.ts must delegate to confirmPlanDialog");
  });

  it("blocked when ctx.hasUI is false (non-interactive mode)", () => {
    assert.ok(dialogSrc.includes("hasUI"), "confirm-dialog.ts must check ctx.hasUI for non-interactive mode");
  });

  it("returns { block: true } when user declines", () => {
    assert.ok(indexSrc.includes("block: true"), "must return block: true when declined");
  });

  it("confirm-dialog.ts skips dialog when already confirmed (idempotent)", () => {
    assert.ok(dialogSrc.includes("alreadyConfirmed"), "must check for existing confirmation before showing dialog");
  });
});
