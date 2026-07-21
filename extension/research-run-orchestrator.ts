import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { convertToPdf } from "./export-pdf.js";
import { JsonlLogger } from "./logger.js";
import { buildMindMapPrompt } from "./mind-map-injector.js";
import type { PrefilterArtifact, ResearchPlan } from "./prefilter.js";
import type { ProfileResolver } from "./profile-resolver.js";
import { assembleReport } from "./report-assembly.js";
import type { Scraper } from "./scraper.js";
import type { searchWeb as SearchWebFn } from "./search/web-search.js";
import { STATE_KEY } from "./session-state.js";
import type { SearchProviderCredentials, SettingsContext } from "./settings-context.js";
import type { ResearchSnapshot } from "./state-machine.js";
import { ResearchStateMachine } from "./state-machine.js";

export interface StatePersistence {
  saveState(snapshot: ResearchSnapshot, extra: Record<string, unknown>): void;
}

export interface OrchestratorDeps {
  searchFn: typeof SearchWebFn;
  scraper: Scraper;
  profileResolver: ProfileResolver;
  artifactsDir?: string;
  searchCred?: SearchProviderCredentials;
  /** Typed state persistence — wired to SessionState.saveState. */
  saveState?: StatePersistence["saveState"];
  /** Settings context for post-processing features (PDF, mind-map). Optional for test compatibility. */
  settings?: SettingsContext;
}

export interface OrchestratorParams {
  planArtifactPath?: string;
  /** Session entries for state lookup (mockable). */
  entries: Array<{
    customType?: string;
    data?: Record<string, unknown>;
    message?: { role?: string; content?: unknown };
  }>;
}

export type OrchestratorResult =
  | { kind: "error"; error: string; details?: Record<string, unknown> }
  | {
      kind: "in_progress";
      snapshot: ResearchSnapshot;
      inject?: string;
      plan: ResearchPlan;
      planArtifactPath: string;
      deepResearchBase: string;
    }
  | {
      kind: "done";
      snapshot: ResearchSnapshot;
      plan: ResearchPlan;
      planArtifactPath: string;
      deepResearchBase: string;
      logsDir: string;
      reportPath?: string;
      pdfResult?: any;
      mindMapPrompt?: string;
      contradictionAnalysis?: string;
    };

export interface PostProcessContext {
  snapshot: ResearchSnapshot;
  plan: ResearchPlan;
  reportsDir: string;
  planArtifactPath: string;
  logsDir: string;
  profileName?: string;
  reportPath?: string;
  /** Settings for processors that need configuration (PDF, mind-map, settings report). */
  settings?: SettingsContext;
}

export type PostProcessResult = Partial<{
  reportPath: string;
  pdfResult: any;
  mindMapPrompt: string;
  contradictionAnalysis: string;
}>;

export interface PostProcessor {
  name: string;
  enabled(settings?: SettingsContext): boolean;
  process(ctx: PostProcessContext): Promise<PostProcessResult>;
}

export class ResearchRunOrchestrator {
  private readonly searchFn: typeof SearchWebFn;
  private readonly scraper: Scraper;
  private readonly artifactsDir?: string;
  private readonly searchCred?: SearchProviderCredentials;
  private readonly saveState?: StatePersistence["saveState"];
  private readonly profileResolver: ProfileResolver;

  /** Settings context for post-processing features (PDF, mind-map). Optional for test compatibility. */
  private readonly settings?: SettingsContext;

  /** Post-processing pipeline — each adapter handles one done-phase task. */
  private readonly postProcessors: PostProcessor[];

  constructor(deps: OrchestratorDeps) {
    this.searchFn = deps.searchFn;
    this.scraper = deps.scraper;
    this.artifactsDir = deps.artifactsDir;
    this.searchCred = deps.searchCred;
    this.saveState = deps.saveState;
    this.profileResolver = deps.profileResolver;
    this.settings = deps.settings;
    this.postProcessors = [new PdfExportProcessor(), new MindMapProcessor()];
  }

  /** Single construction site for ResearchStateMachine. Optional logger covers the only variance between first and subsequent calls. */
  private createMachine(artifactsDir: string, logger?: JsonlLogger): ResearchStateMachine {
    return new ResearchStateMachine({
      searchFn: this.searchFn,
      scraper: this.scraper,
      profileResolver: this.profileResolver,
      artifactsDir,
      searchCred: this.searchCred,
      logger,
      defaultReportStyle: this.settings?.reportStyle,
    });
  }

  /** Run one machine step and persist state. Single seam for handleFirstCall + handleSubsequentCall. */
  private async runAndPersist(
    machine: ResearchStateMachine,
    snapshot: ResearchSnapshot,
    plan: ResearchPlan,
    parsedResponse: string | undefined,
    extra: Record<string, unknown>,
  ) {
    const result = await machine.next(snapshot, plan, parsedResponse);
    this.saveState?.(result.snapshot, extra);
    return result;
  }

  async handle(params: OrchestratorParams): Promise<OrchestratorResult> {
    if (params.planArtifactPath) {
      return this.handleFirstCall(params.planArtifactPath, params.entries);
    }
    return this.handleSubsequentCall(params.entries);
  }

  private async handleFirstCall(
    planArtifactPath: string,
    entries: OrchestratorParams["entries"],
  ): Promise<OrchestratorResult> {
    if (!existsSync(planArtifactPath)) {
      return { kind: "error", error: "artifact_not_found", details: {} };
    }

    // Guard: if research already in progress, continue existing run
    const existingState = [...entries].reverse().find((e) => e.customType === STATE_KEY);
    if (existingState) {
      const existingPlanPath = (existingState.data as Record<string, unknown>)?.planArtifactPath as string | undefined;
      if (existingPlanPath === planArtifactPath) {
        return this.handleSubsequentCall(entries);
      }
      // Different plan — start fresh, fall through
    }

    const raw = readFileSync(planArtifactPath, "utf-8");
    const artifact: PrefilterArtifact = JSON.parse(raw);
    const snapshot = ResearchStateMachine.init(artifact.plan, this.profileResolver, artifact.runId);

    const deepResearchBase = join(dirname(planArtifactPath), "..");
    const artifactsDir = join(deepResearchBase, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const logsDir = join(deepResearchBase, "logs");
    const reportsDir = join(deepResearchBase, "reports");
    mkdirSync(reportsDir, { recursive: true });

    const runLogger = new JsonlLogger(snapshot.runId, join(logsDir, `${snapshot.runId}.log`));
    const machine = this.createMachine(artifactsDir, runLogger);

    const result = await this.runAndPersist(machine, snapshot, artifact.plan, undefined, {
      plan: artifact.plan,
      planArtifactPath,
      deepResearchBase,
    });

    return {
      kind: "in_progress",
      snapshot: result.snapshot,
      inject: result.inject,
      plan: artifact.plan,
      planArtifactPath,
      deepResearchBase,
    };
  }

  private async handleSubsequentCall(entries: OrchestratorParams["entries"]): Promise<OrchestratorResult> {
    const lastAssistant = [...entries].reverse().find((e) => e.message?.role === "assistant");
    const rawResponse = lastAssistant?.message?.content;

    const lastStateEntry = [...entries].reverse().find((e) => e.customType === STATE_KEY);
    if (!lastStateEntry) {
      return { kind: "error", error: "no_state", details: {} };
    }

    const stateData = lastStateEntry.data as Record<string, unknown>;
    const plan = stateData.plan as ResearchPlan;
    const planArtifactPath = stateData.planArtifactPath as string;

    let deepResearchBase = (stateData.deepResearchBase as string) || join(dirname(planArtifactPath), "..");
    if (!deepResearchBase.startsWith("/")) deepResearchBase = join(process.cwd(), deepResearchBase);
    const logsDir = join(deepResearchBase, "logs");
    const artifactsDir = join(deepResearchBase, "artifacts");

    if (!plan) {
      return { kind: "error", error: "corrupted_state", details: {} };
    }

    const machine = this.createMachine(artifactsDir);

    // Machine owns draft restoration + agent response parsing via resume()
    const result = await machine.resume(stateData, rawResponse, plan);
    this.saveState?.(result.snapshot, { plan, planArtifactPath, deepResearchBase });

    if (result.phase === "done") {
      return this.buildDoneResult(result.snapshot, plan, planArtifactPath, deepResearchBase, logsDir);
    }

    return {
      kind: "in_progress",
      snapshot: result.snapshot,
      inject: result.inject,
      plan,
      planArtifactPath,
      deepResearchBase,
    };
  }
  /**
   * Post-process a done phase via a pipeline of PostProcessor adapters.
   * Add steps by registering, not editing this method.
   */
  private async buildDoneResult(
    snapshot: ResearchSnapshot,
    plan: ResearchPlan,
    planArtifactPath: string,
    deepResearchBase: string,
    logsDir: string,
  ): Promise<OrchestratorResult> {
    const base = { snapshot, plan, planArtifactPath, deepResearchBase, logsDir };

    if (!this.settings) {
      return { kind: "done", ...base };
    }

    const profileName =
      typeof plan.profile === "object" && "name" in plan.profile ? (plan.profile as any).name : undefined;

    // Always run: report assembly (was AssembleReportProcessor)
    const reportPath = assembleReport({
      snapshot,
      topic: plan.topic,
      reportsDir: this.settings.reportsDir,
      planArtifactPath,
      logsDir,
      profileName,
      appendSettingsReport: this.settings.settingsReport.inReport ?? false,
      settings: this.settings,
    });

    // Always run: contradiction detection (was ContradictionProcessor)
    let contradictionAnalysis: string | undefined;
    const contradictions = snapshot.allFindings.filter(
      (f) => f.text.includes("CONTRADICTION") || f.text.includes("contradiction") || f.text.includes("debatable"),
    );
    if (contradictions.length > 0) {
      contradictionAnalysis = [
        `## Contradictions & Debatable Facts`,
        ``,
        ...contradictions.map((f) => `- ${f.text.substring(0, 300)} [Source: ${f.sourceUrl}]`),
        ``,
      ].join("\n");
    }

    // Run gated PostProcessor pipeline (PDF, MindMap only)
    const ctx: PostProcessContext = {
      snapshot,
      plan,
      reportsDir: this.settings.reportsDir,
      planArtifactPath,
      logsDir,
      reportPath,
      profileName,
      settings: this.settings,
    };

    const results: PostProcessResult[] = [];
    for (const pp of this.postProcessors) {
      if (pp.enabled(this.settings)) {
        results.push(await pp.process(ctx));
      }
    }

    const merged: PostProcessResult = Object.assign({}, ...results);

    return {
      kind: "done",
      ...base,
      reportPath,
      contradictionAnalysis,
      ...merged,
    };
  }
}

// ─── PostProcessor adapters (gated only) ────────────────────

class PdfExportProcessor implements PostProcessor {
  name = "pdf-export";
  enabled(s?: SettingsContext) {
    return s?.pdfExport ?? false;
  }
  async process(ctx: PostProcessContext): Promise<PostProcessResult> {
    if (!ctx.reportPath) return {};
    const r = await convertToPdf({ reportPath: ctx.reportPath });
    if (r.kind === "success") return { pdfResult: { kind: "success", outputPath: r.outputPath, method: r.method } };
    if (r.kind === "fallback") return { pdfResult: { kind: "fallback", error: r.error, outputPath: r.outputPath } };
    return {};
  }
}

class MindMapProcessor implements PostProcessor {
  name = "mind-map";
  enabled(s?: SettingsContext) {
    return (s?.mindMap ?? false) && true;
  }
  async process(ctx: PostProcessContext): Promise<PostProcessResult> {
    if (ctx.snapshot.allFindings.length === 0) return {};
    const summary = ctx.snapshot.allFindings
      .slice(0, 30)
      .map((f, i) => `${i + 1}. ${f.text.substring(0, 200)}`)
      .join("\n");
    return { mindMapPrompt: buildMindMapPrompt(ctx.plan.topic, summary) };
  }
}
