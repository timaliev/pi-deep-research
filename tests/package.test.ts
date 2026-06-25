import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname ?? ".", "..");

describe("Package installation", () => {
  it("root package.json exists with pi.extensions field", () => {
    const pkgPath = join(repoRoot, "package.json");
    assert.ok(existsSync(pkgPath), "package.json must exist at repo root");

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    assert.ok(pkg.pi, "must have 'pi' field");
    assert.ok(Array.isArray(pkg.pi.extensions), "pi.extensions must be an array");
    assert.ok(pkg.pi.extensions.length > 0, "must have at least one extension entry");
    assert.ok(
      pkg.pi.extensions.some((e: string) => e.includes("index.ts")),
      "must point to an index.ts file"
    );
  });

  it("extension package.json has no stale duck-duck-scrape dependency", () => {
    const extPkgPath = join(repoRoot, "extension", "package.json");
    const pkg = JSON.parse(readFileSync(extPkgPath, "utf-8"));
    assert.equal(
      pkg.dependencies?.["duck-duck-scrape"],
      undefined,
      "duck-duck-scrape should not be a dependency (unused since unified search)"
    );
  });
});
