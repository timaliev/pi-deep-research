import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Real env keys (must match settings-context.ts)
const ENV_KEYS = {
  reportsDir: "DEEP_RESEARCH_REPORTS_DIR",
  artifactsDir: "DEEP_RESEARCH_ARTIFACTS_DIR",
  defaultProfile: "DEEP_RESEARCH_DEFAULT_PROFILE",
};

// We'll test against the real implementation
describe("SettingsContext — unified settings cascade", () => {
  let tmpHome: string;
  let tmpCwd: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `pi-test-home-${Date.now()}-${Math.random()}`);
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    // Clear env vars
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    delete process.env.BRAVE_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.YANDEX_OAUTH_TOKEN;
    delete process.env.YANDEX_FOLDER_ID;
    // Reset singleton
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    for (const key of Object.values(ENV_KEYS)) delete process.env[key];
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  // ─── Basic existence and defaults ──────────────────────────
  it("exposes reportsDir, artifactsDir, defaultProfile, profiles, credentials", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(typeof ctx.reportsDir, "string");
    assert.equal(typeof ctx.artifactsDir, "string");
    assert.equal(typeof ctx.defaultProfile, "string");
    assert.equal(typeof ctx.profiles, "object");
    assert.ok(ctx.profiles.default);
    assert.equal(typeof ctx.credentials, "object");
    // ProfileResolver can be built from settings
    const { ProfileResolver } = await import("../extension/profile-resolver.js");
    const pr = new ProfileResolver({}, ctx.defaultProfile, ctx.profiles);
    assert.equal(pr.resolve({ name: "default" }).breadth, 4);
  });

  // ─── Defaults when no settings files exist ─────────────────
  it("returns built-in defaults when no files", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.ok(ctx.reportsDir.includes("deep-research"));
    assert.ok(ctx.artifactsDir.includes("deep-research"));
    assert.equal(ctx.defaultProfile, "default");
    assert.ok(ctx.profiles.default.breadth === 4);
    assert.ok(ctx.profiles.fast.breadth === 2);
    assert.ok(ctx.profiles.deep.breadth === 6);
  });

  // ─── Global settings override built-in ─────────────────────
  it("global settings override built-in defaults", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: {
          defaultProfile: "fast",
          reportsDir: "/global/reports",
          artifactsDir: "/global/artifacts",
          profiles: { fast: { depth: 99 } },
        },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.defaultProfile, "fast");
    assert.equal(ctx.reportsDir, "/global/reports");
    assert.equal(ctx.artifactsDir, "/global/artifacts");
    assert.equal(ctx.profiles.fast.depth, 99);
    assert.equal(ctx.profiles.fast.breadth, 2); // unchanged from built-in
  });

  // ─── Local settings override global ────────────────────────
  it("local settings override global", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: { defaultProfile: "fast", reportsDir: "/global/reports" },
      }),
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: { defaultProfile: "deep", reportsDir: "/local/reports" },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.defaultProfile, "deep");
    assert.equal(ctx.reportsDir, "/local/reports");
  });

  // ─── Env vars override local ───────────────────────────────
  it("env vars override local settings", async () => {
    process.env[ENV_KEYS.reportsDir] = "/env/reports";
    process.env[ENV_KEYS.defaultProfile] = "deep";

    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: { defaultProfile: "fast", reportsDir: "/local/reports" },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.reportsDir, "/env/reports");
    assert.equal(ctx.defaultProfile, "deep");
  });

  // ─── Profiles merge local into global, user wins ──────────
  it("profiles merge: local extends global, user fields win", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: {
          profiles: { custom: { breadth: 5, depth: 5 }, fast: { breadth: 3 } },
        },
      }),
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: {
          profiles: { custom: { depth: 10 }, experimental: { breadth: 8, depth: 4 } },
        },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.profiles.custom.breadth, 5);  // from global
    assert.equal(ctx.profiles.custom.depth, 10);    // from local (wins over global 5)
    assert.equal(ctx.profiles.fast.breadth, 3);     // from global
    assert.equal(ctx.profiles.experimental.breadth, 8); // new profile from local
  });

  // ─── API keys from settings ────────────────────────────────
  it("credentials exposes API keys from settings via cascade", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        deepResearch: {
          searchProviders: { brave: { apiKey: "global-key" } },
        },
      }),
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: {
          searchProviders: { brave: { apiKey: "local-key" }, tavily: { apiKey: "tvly-local" } },
        },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    // Local overrides global for brave
    assert.equal(ctx.credentials.get("brave", "apiKey"), "local-key");
    // tavily from local only
    assert.equal(ctx.credentials.get("tavily", "apiKey"), "tvly-local");
  });

  // ─── API keys: env overrides settings ──────────────────────
  it("credentials: env overrides settings for API keys", async () => {
    process.env.BRAVE_API_KEY = "env-brave-key";

    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: {
          searchProviders: { brave: { apiKey: "local-key" } },
        },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.credentials.get("brave", "apiKey"), "env-brave-key");
  });

  // ─── Profiles have no env override ─────────────────────────
  it("profiles skip env override (only local → global → built-in)", async () => {
    process.env.DEEP_RESEARCH_PROFILES = '{"custom":{"breadth":99}}';

    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({
        deepResearch: { profiles: { custom: { breadth: 7 } } },
      }),
    );

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    // local wins, env is ignored for profiles
    assert.equal(ctx.profiles.custom.breadth, 7);
  });

  // ─── Singleton: second init returns same instance ──────────
  it("subsequent init() returns same instance", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const a = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    const b = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.strictEqual(a, b);
  });

  // ─── Corrupt settings file doesn't crash ───────────────────
  it("corrupt JSON returns built-in defaults gracefully", async () => {
    writeFileSync(join(tmpHome, ".pi", "agent", "settings.json"), "not json{{{");

    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });

    assert.equal(ctx.defaultProfile, "default");
    assert.ok(ctx.profiles.default.breadth === 4);
  });
});
