import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mergeProfiles, ProfileResolver } from "../extension/profile-resolver.js";

const TEST_DIR = join(import.meta.dirname ?? ".", "..", "test-settings-merge");

// ─── Candidate 2: settings loaded from file ──────────────────────

describe("settings loading from disk", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("loadSettings reads deepResearch.profiles from JSON file", () => {
    const settingsPath = join(TEST_DIR, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          deepResearch: {
            profiles: {
              deep: { breadth: 8, depth: 4, concurrency: 6 },
              exhaustive: { breadth: 10, depth: 5, concurrency: 8 },
            },
            defaultProfile: "deep",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const loaded = loadSettingsFromFile(settingsPath);

    assert.ok(loaded.profiles, "must have profiles");
    assert.equal(loaded.profiles.deep?.breadth, 8, "user deep.breadth = 8");
    assert.equal(loaded.profiles.deep?.depth, 4, "user deep.depth = 4");
    assert.ok(loaded.profiles.exhaustive, "must include user-defined profile");
    assert.equal(loaded.defaultProfile, "deep");
  });

  it("loadSettings returns empty profiles when no deepResearch key", () => {
    const settingsPath = join(TEST_DIR, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ other: true }), "utf-8");

    const loaded = loadSettingsFromFile(settingsPath);
    assert.deepEqual(loaded.profiles, {});
    assert.equal(loaded.defaultProfile, undefined);
  });

  it("loadSettings returns empty profiles when file missing", () => {
    const loaded = loadSettingsFromFile(join(TEST_DIR, "nonexistent.json"));
    assert.deepEqual(loaded.profiles, {});
  });

  it("loadSettings returns empty profiles when JSON malformed", () => {
    const settingsPath = join(TEST_DIR, "settings.json");
    writeFileSync(settingsPath, "not json", "utf-8");

    const loaded = loadSettingsFromFile(settingsPath);
    assert.deepEqual(loaded.profiles, {});
  });
});

// ─── Candidate 1: profile merge ──────────────────────────────────

describe("profile merging", () => {
  it("mergeProfiles: user overrides built-in key", () => {
    const builtin = {
      default: { breadth: 4, depth: 2, concurrency: 4 },
      deep: { breadth: 6, depth: 3, concurrency: 4 },
    };
    const user = {
      deep: { breadth: 8, depth: 4 },
    };

    const merged = mergeProfiles(builtin, user);

    assert.equal(merged.default.breadth, 4, "default untouched");
    assert.equal(merged.deep.breadth, 8, "deep.breadth overridden");
    assert.equal(merged.deep.depth, 4, "deep.depth overridden");
    assert.equal(merged.deep.concurrency, 4, "deep.concurrency kept from built-in");
  });

  it("mergeProfiles: user adds new profile", () => {
    const builtin = {
      default: { breadth: 4, depth: 2, concurrency: 4 },
    };
    const user = {
      exhaustive: { breadth: 10, depth: 5, concurrency: 8, maxSearchCalls: 100 },
    };

    const merged = mergeProfiles(builtin, user);

    assert.equal(merged.default.breadth, 4);
    assert.equal(merged.exhaustive.breadth, 10);
    assert.equal(merged.exhaustive.maxSearchCalls, 100);
  });

  it("mergeProfiles: empty user profiles returns built-in unchanged", () => {
    const builtin = { default: { breadth: 4, depth: 2, concurrency: 4 } };
    const merged = mergeProfiles(builtin, {});
    assert.deepEqual(merged, builtin);
  });

  it("mergeProfiles: user fully replaces soft-limit fields", () => {
    const builtin = {
      default: { breadth: 4, depth: 2, concurrency: 4 },
    };
    const user = {
      default: { maxSearchCalls: 50, maxElapsedSeconds: 300 },
    };
    const merged = mergeProfiles(builtin, user);

    assert.equal(merged.default.maxSearchCalls, 50);
    assert.equal(merged.default.maxElapsedSeconds, 300);
    assert.equal(merged.default.breadth, 4, "breadth unchanged");
  });
});

// ─── Candidate 4: unified ProfileResolver ────────────────────────

describe("ProfileResolver", () => {
  it("resolves named profile from merged presets", () => {
    const builtin = {
      default: { breadth: 4, depth: 2, concurrency: 4 },
      deep: { breadth: 6, depth: 3, concurrency: 4 },
    };
    const user = {
      deep: { breadth: 8 },
    };

    const resolver = new ProfileResolver(user, "default", builtin);

    assert.equal(resolver.resolve({ name: "deep" }).breadth, 8, "user override active");
    assert.equal(resolver.resolve({ name: "deep" }).depth, 3, "built-in fill");
    assert.equal(resolver.resolve({ name: "default" }).breadth, 4);
  });

  it("resolve returns defaultProfile when name not found", () => {
    const builtin = {
      default: { breadth: 4, depth: 2, concurrency: 4 },
      fast: { breadth: 2, depth: 1, concurrency: 2 },
    };
    const resolver = new ProfileResolver({}, "fast", builtin);

    assert.equal(resolver.resolve({ name: "nonexistent" as any }).breadth, 2, "falls back to defaultProfile=fast");
    assert.equal(resolver.resolve({ name: "unknown" as any }).concurrency, 2);
  });

  it("resolve handles custom profiles", () => {
    const builtin = { default: { breadth: 4, depth: 2, concurrency: 4 } };
    const resolver = new ProfileResolver({}, "default", builtin);

    const custom = resolver.resolve({ name: "custom", breadth: 7, depth: 3 });
    assert.equal(custom.breadth, 7);
    assert.equal(custom.depth, 3);
    assert.equal(custom.concurrency, 4, "inherits from custom preset default");
  });

  it("listNames returns all merged profile names", () => {
    const builtin = { default: { breadth: 4, depth: 2, concurrency: 4 } };
    const user = { exhaustive: { breadth: 10, depth: 5, concurrency: 8 } };

    const resolver = new ProfileResolver(user, "default", builtin);
    const names = resolver.listNames();

    assert.ok(names.includes("default"));
    assert.ok(names.includes("exhaustive"));
    assert.equal(names.length, 2);
  });
});

// ─── Test helpers ────────────────────────────────────────────────

function loadSettingsFromFile(path: string): { profiles: Record<string, any>; defaultProfile?: string } {
  try {
    if (!existsSync(path)) return { profiles: {} };
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const dr = (raw.deepResearch ?? {}) as any;
    return {
      profiles: dr.profiles ?? {},
      defaultProfile: dr.defaultProfile,
    };
  } catch {
    return { profiles: {} };
  }
}
