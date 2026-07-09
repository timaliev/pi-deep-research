import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Smoke test: index.ts must load without parse errors
describe("Extension load", () => {
  it("index.ts has no duplicate const declarations", async () => {
    // This test just confirms the module can be parsed
    // The actual error was caught by the runtime; we verify the fix
    let parseError: Error | null = null;
    try {
      await import("../extension/index.js");
    } catch (e: any) {
      parseError = e;
    }
    // index.ts imports pi types which aren't available in test env,
    // so a module-not-found error is expected. But NOT a parse error.
    if (parseError && parseError.message?.includes("already been declared")) {
      assert.fail(`Parse error: ${parseError.message}`);
    }
    // If we got here, no declaration conflict
    assert.ok(true);
  });
});
