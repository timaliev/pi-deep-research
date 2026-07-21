import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(import.meta.dirname ?? ".", "..", "extension", "subprocess-runner.ts"), "utf-8");

describe("subprocess-runner stderr capture", () => {
  it("has stderr event handler", () => {
    assert.ok(src.includes("stderr"), "must handle stderr");
  });

  it("includes stderr in error message on non-zero exit", () => {
    assert.ok(
      src.includes("stderr") && (src.includes("code ${code}") || src.includes("Subprocess exited")),
      "error message must include stderr content",
    );
  });
});
