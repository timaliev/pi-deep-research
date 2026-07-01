import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ResearchRunOrchestrator", () => {
  it("module exports ResearchRunOrchestrator class", async () => {
    const mod = await import("../extension/research-run-orchestrator.js");
    assert.ok(typeof mod.ResearchRunOrchestrator === "function", "must export class");
  });

  it("orchestrator accepts dependencies via constructor", async () => {
    const { ResearchRunOrchestrator } = await import("../extension/research-run-orchestrator.js");
    const orch = new ResearchRunOrchestrator({
      searchFn: async () => [],
      scraper: { scrape: async () => ({ url: "", title: "", content: "" }) },
    });
    assert.ok(orch, "orchestrator must instantiate");
    assert.ok(typeof orch.handle === "function", "must have handle method");
  });

  it("first call without plan_artifact_path returns error", async () => {
    const { ResearchRunOrchestrator } = await import("../extension/research-run-orchestrator.js");
    const orch = new ResearchRunOrchestrator({
      searchFn: async () => [],
      scraper: { scrape: async () => ({ url: "", title: "", content: "" }) },
    });
    const result = await orch.handle({ entries: [] });
    assert.equal(result.kind, "error");
  });

  it("first call with plan_artifact_path creates new run", async () => {
    const tmpDir = join(tmpdir(), `orch-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const artifactsDir = join(tmpDir, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const planPath = join(artifactsDir, "prefilter.json");
    writeFileSync(planPath, JSON.stringify({
      version: 1,
      runId: "test-run",
      createdAt: new Date().toISOString(),
      inputTopic: "Test",
      plan: {
        topic: "Test",
        goal: "Test goal",
        researchQuestions: ["Q1", "Q2"],
        engines: ["duckduckgo"],
        profile: { name: "default" },
        scope: { include: "", exclude: "" },
        estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
      },
    }));

    try {
      const { ResearchRunOrchestrator } = await import("../extension/research-run-orchestrator.js");
      const mockResults = [{ title: "T", url: "https://a.com", snippet: "s", engine: "ddg" }];
      const orch = new ResearchRunOrchestrator({
        searchFn: async () => mockResults,
        scraper: { scrape: async (url: string) => ({ url, title: url, content: "mock" }) },
        artifactsDir,
        appendEntry: () => {},
      });
      const result = await orch.handle({
        planArtifactPath: planPath,
        entries: [],
      });

      assert.equal(result.kind, "in_progress");
      assert.ok(result.snapshot, "must have snapshot");
      assert.equal(result.snapshot.phase, "extracting");
      assert.ok(result.inject, "must have inject prompt");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
