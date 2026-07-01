import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("PhaseRouter", () => {
  it("doExtracting delegates phase decision to a separate function", () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "state-machine.ts"),
      "utf-8",
    );
    // doExtracting must call a separate phase routing function, not inline the logic
    const extractingMethod = src.match(/private doExtracting[\s\S]*?\{[\s\S]*?^\s{2}\}/m);
    assert.ok(extractingMethod, "doExtracting method must exist");

    // The phase decision must call phaseRouter function
    const callsRouter = extractingMethod![0].includes("phaseRouter") ||
      extractingMethod![0].includes("nextPhase") ||
      extractingMethod![0].includes("routePhase");
    assert.ok(
      callsRouter,
      "doExtracting must delegate phase decision to a separate function (PhaseRouter)"
    );
  });

  it("PhaseRouter is a pure function of snapshot + plan", () => {
    const src = readFileSync(
      join(import.meta.dirname ?? ".", "..", "extension", "state-machine.ts"),
      "utf-8",
    );

    // PhaseRouter should be a standalone function, not a method
    const routerFn = src.match(/(?:export\s+)?function\s+(\w*[Pp]hase\w*)\s*\(/);
    assert.ok(routerFn, "PhaseRouter must be a standalone function");
    const fnName = routerFn[1];
    // Should accept snapshot and plan (or derived fields)
    const fnSig = src.match(new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)`));
    assert.ok(fnSig, "PhaseRouter function signature must exist");
    assert.ok(
      fnSig[0].includes("snapshot") || fnSig[0].includes("currentDepth") || fnSig[0].includes("softLimit"),
      "PhaseRouter must accept snapshot or derived state fields"
    );
  });
});
