/**
 * Engine allowlist — "not enabled" label for engines with keys but not in allowlist.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "prefilter-prompts.ts"), "utf-8");

describe("Engine allowlist — not enabled label", () => {
  it("shows 'not enabled' for disallowed engines", () => {
    assert.ok(
      src.includes("not enabled") || src.includes("not_enabled"),
      "must show 'not enabled' label for disallowed engines",
    );
  });
});
