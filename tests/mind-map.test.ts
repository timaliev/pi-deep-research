import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Settings: mindMap ───────────────────────────────────────
describe("mindMap setting", () => {
  let tmpHome: string;
  let tmpCwd: string;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `pi-test-home-${Date.now()}-${Math.random()}`);
    tmpCwd = join(tmpdir(), `pi-test-cwd-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
    delete process.env.DEEP_RESEARCH_MIND_MAP;
    const { SettingsContext } = await import("../extension/settings-context.js");
    (SettingsContext as any)._reset();
  });

  afterEach(() => {
    delete process.env.DEEP_RESEARCH_MIND_MAP;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("defaults to false when no settings or env", async () => {
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.mindMap, false);
  });

  it("reads from global settings", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ deepResearch: { mindMap: true } }),
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.mindMap, true);
  });

  it("local settings override global", async () => {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ deepResearch: { mindMap: true } }),
    );
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({ deepResearch: { mindMap: false } }),
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.mindMap, false);
  });

  it("env DEEP_RESEARCH_MIND_MAP overrides all", async () => {
    process.env.DEEP_RESEARCH_MIND_MAP = "true";
    writeFileSync(
      join(tmpCwd, ".pi", "settings.json"),
      JSON.stringify({ deepResearch: { mindMap: false } }),
    );
    const { SettingsContext } = await import("../extension/settings-context.js");
    const ctx = SettingsContext.init({ cwd: tmpCwd, homeAgentDir: join(tmpHome, ".pi", "agent") });
    assert.equal(ctx.mindMap, true);
  });
});

// ─── mind_map tool registration ─────────────────────────────
describe("mind_map tool", () => {
  const readIndex = () => readFileSync(
    join(import.meta.dirname ?? ".", "..", "extension", "index.ts"),
    "utf-8",
  );

  it("tool is registered in index.ts", () => {
    const src = readIndex();
    assert.ok(src.includes('"mind_map"'), "index.ts must register mind_map tool");
  });

  it("tool accepts topic, content, and optional save_path", () => {
    const src = readIndex();
    assert.ok(src.includes("topic"), "must have topic param");
    assert.ok(src.includes("content"), "must have content param");
    assert.ok(src.includes("save_path"), "must have save_path param");
  });

  it("tool sends injection prompt via pi.sendUserMessage", () => {
    const src = readIndex();
    assert.ok(
      src.includes("sendUserMessage"),
      "must inject prompt via pi.sendUserMessage",
    );
  });

  it("injection prompt includes Mermaid graph TD instruction", () => {
    const src = readIndex();
    assert.ok(
      src.includes("graph TD") || src.includes("mermaid") || src.includes("Mermaid"),
      "prompt must instruct agent to generate Mermaid graph TD",
    );
  });
});

// ─── Auto mind-map after run_research done ──────────────────
describe("auto mind-map after run_research done", () => {
  const readRunResearch = () => readFileSync(
    join(import.meta.dirname ?? ".", "..", "extension", "tools", "run-research.ts"),
    "utf-8",
  );

  it("run-research tool checks mindMap setting on done", () => {
    const src = readRunResearch();
    assert.ok(
      src.includes("mindMap"),
      "run-research done handler must check mindMap setting",
    );
  });

  it("run-research tool imports settings for mindMap check", () => {
    const src = readRunResearch();
    assert.ok(
      src.includes("settings"),
      "createRunResearchTool receives settings param",
    );
  });

  it("auto mind-map injects prompt via pi.sendUserMessage", () => {
    const src = readRunResearch();
    assert.ok(
      src.includes("sendUserMessage") && src.includes("mindMap"),
      "must inject mind map prompt when mindMap enabled",
    );
  });

  it("appends mind map section to report", () => {
    const src = readRunResearch();
    assert.ok(
      src.includes("Mind Map") || src.includes("mind_map") || src.includes("mindMap"),
      "done handler must reference mind map output",
    );
  });
});
