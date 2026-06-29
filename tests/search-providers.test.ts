import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSearchProviders, SearchProviderCredentials } from "../extension/search-providers.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-search-providers");

describe("SearchProviderCredentials", () => {
  beforeEach(() => { mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("loads searchProviders from settings.json", () => {
    const path = join(TEST_DIR, "settings.json");
    writeFileSync(path, JSON.stringify({
      deepResearch: {
        searchProviders: {
          brave: { apiKey: "bsa-key" },
          tavily: { apiKey: "tvly-key" },
          yandex: { oauthToken: "ya-token", folderId: "ya-folder" },
        },
      },
    }, null, 2), "utf-8");

    const providers = loadSearchProviders(path);
    assert.equal(providers.brave?.apiKey, "bsa-key");
    assert.equal(providers.tavily?.apiKey, "tvly-key");
    assert.equal(providers.yandex?.oauthToken, "ya-token");
    assert.equal(providers.yandex?.folderId, "ya-folder");
  });

  it("returns empty when no searchProviders key", () => {
    const path = join(TEST_DIR, "settings.json");
    writeFileSync(path, JSON.stringify({ deepResearch: {} }), "utf-8");
    const providers = loadSearchProviders(path);
    assert.deepEqual(providers, {});
  });

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

  it("has returns missing keys when required keys absent", () => {
    const cred = new SearchProviderCredentials({
      yandex: { oauthToken: "tok" },
    });

    const missing = cred.has("yandex", ["oauthToken", "folderId"]);
    assert.deepEqual(missing, ["folderId"]);
  });

  it("has returns empty when all keys present", () => {
    const cred = new SearchProviderCredentials({
      brave: { apiKey: "key" },
    });
    assert.deepEqual(cred.has("brave", ["apiKey"]), []);
  });

  it("has returns all keys when engine unknown", () => {
    const cred = new SearchProviderCredentials({});
    assert.deepEqual(cred.has("brave", ["apiKey"]), ["apiKey"]);
  });
});
