import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileResolver } from "../extension/profile-resolver.js";

const defaultResolver = new ProfileResolver({}, "default");

describe("ResearchRunOrchestrator", () => {
  it("module exports ResearchRunOrchestrator class", async () => {
    const mod = await import("../extension/research-run-orchestrator.js");
    assert.ok(typeof mod.ResearchRunOrchestrator === "function", "must export class");
  });

  it("orchestrator accepts dependencies via constructor", async () => {
    const { ResearchRunOrchestrator } = await import("../extension/research-run-orchestrator.js");
    const orch = new ResearchRunOrchestrator({
      searchFn: async () => [],
      profileResolver: defaultResolver,
      scraper: { scrape: async () => ({ url: "", title: "", content: "" }) },
    });
    assert.ok(orch, "orchestrator must instantiate");
    assert.ok(typeof orch.handle === "function", "must have handle method");
  });

  it("first call without plan_artifact_path returns error", async () => {
    const { ResearchRunOrchestrator } = await import("../extension/research-run-orchestrator.js");
    const orch = new ResearchRunOrchestrator({
      searchFn: async () => [],
      profileResolver: defaultResolver,
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
        profileResolver: defaultResolver,
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

  it("draft recovery strips tool-call XML from agent response", async () => {
    const tmpDir = join(tmpdir(), `orch-draft-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const artifactsDir = join(tmpDir, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const planPath = join(artifactsDir, "prefilter.json");
    writeFileSync(planPath, JSON.stringify({
      version: 1,
      runId: "test-draft-run",
      createdAt: new Date().toISOString(),
      inputTopic: "Test",
      plan: {
        topic: "Test",
        goal: "Test goal",
        researchQuestions: ["Q1"],
        engines: ["duckduckgo"],
        profile: { name: "fast" },
        scope: { include: "", exclude: "" },
        estimatedCost: { searchCalls: 0, scrapeCalls: 0, description: "" },
      },
    }));

    try {
      const { ResearchRunOrchestrator } = await import("../extension/research-run-orchestrator.js");
      const STATE_KEY = "deep-research:state";
      const testRunId = "test-draft-run";
      const mockResults = [{ title: "T", url: "https://a.com", snippet: "s", engine: "ddg" }];
      const orch = new ResearchRunOrchestrator({
        searchFn: async () => mockResults,
        profileResolver: defaultResolver,
      scraper: { scrape: async (url: string) => ({ url, title: url, content: "mock content" }) },
        artifactsDir,
        appendEntry: () => {},
      });

      // First call: initialize run (will go searching → extracting)
      const result1 = await orch.handle({
        planArtifactPath: planPath,
        entries: [],
      });
      assert.equal(result1.kind, "in_progress");
      const snapshot1 = result1.snapshot;

      // Build session entries simulating a return to drafting phase
      // with an agent response containing tool-call XML
      const agentResponseWithXml = `# Full Research Report\n\nThis is a comprehensive research report with detailed findings across multiple sections and substantial analysis.\n\n## Section 1\nContent here with enough text to exceed 40 characters threshold.\n\n## Section 2\nMore content.\n\n<tool_calls>\n<invoke name="run_research">\n<parameter name="plan_artifact_path" string="true">/path</parameter>\n</invoke>\n</tool_calls>`;

      const entries = [
        {
          customType: STATE_KEY,
          data: {
            ...snapshot1,
            phase: "drafting",
            draftReady: true,
            draftLength: 500,
            plan: result1.plan,
            planArtifactPath: planPath,
            deepResearchBase: tmpDir,
          },
        },
        {
          message: { role: "assistant", content: agentResponseWithXml },
        },
      ];

      // Second call: draft recovery → transitions to saving phase
      const result2 = await orch.handle({ entries });
      assert.equal(result2.kind, "in_progress");
      assert.equal(result2.snapshot.phase, "saving");

      // Third call: saving → done
      const entries3 = [
        {
          customType: STATE_KEY,
          data: {
            ...result2.snapshot,
            plan: result2.plan,
            planArtifactPath: result2.planArtifactPath,
            deepResearchBase: tmpDir,
          },
        },
      ];
      const result3 = await orch.handle({ entries: entries3 });
      assert.equal(result3.kind, "done");

      // Verify draft text does NOT contain tool-call XML
      const draft = result3.snapshot.draftReport;
      assert.ok(draft, "draftReport must exist");
      assert.ok(!draft.includes("<tool_calls>"), "draft must not contain tool-call XML");
      assert.ok(!draft.includes("run_research"), "draft must not contain tool names");
      assert.ok(draft.includes("# Full Research Report"), "draft must contain report content");
      assert.ok(draft.includes("Section 1"), "draft must contain section headings");
      assert.ok(draft.includes("Section 2"), "draft must contain all sections");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
