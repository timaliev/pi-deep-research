import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SearchProviderCredentials } from "../extension/settings-context.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-search-providers");

describe("SearchProviderCredentials", () => {
  beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("get returns setting value when no env var", () => {
    const cred = new SearchProviderCredentials({
      brave: { apiKey: "bsa-key" },
    });
    assert.equal(cred.get("brave", "apiKey"), "bsa-key");
  });

  it("get returns env var over settings", () => {
    const prev = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "env-key";
    const cred = new SearchProviderCredentials({
      brave: { apiKey: "bsa-key" },
    });

    const val = cred.get("brave", "apiKey");
    assert.equal(val, "env-key", "env var must override settings.json");

    if (prev) process.env.BRAVE_API_KEY = prev; else delete process.env.BRAVE_API_KEY;
  });

  it("get returns undefined when no source has it", () => {
    const cred = new SearchProviderCredentials({});
    assert.equal(cred.get("brave", "apiKey"), undefined);
  });
});
