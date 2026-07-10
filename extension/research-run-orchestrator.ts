import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { convertToPdf } from "./export-pdf.js";
import { JsonlLogger } from "./logger.js";
import { buildMindMapPrompt } from "./mind-map-injector.js";
import type { PrefilterArtifact, ResearchPlan } from "./prefilter.js";
import type { ProfileResolver } from "./profile-resolver.js";
import { assembleReport } from "./report-assembly.js";
import { ResearchDraft } from "./research-draft.js";
import type { Scraper } from "./scraper.js";
import type { searchWeb as SearchWebFn } from "./search/web-search.js";
import type { SearchProviderCredentials, SettingsContext } from "./settings-context.js";
import { appendSettingsSection } from "./settings-reporter.js";
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

const STATE_KEY = "deep-research:state";

export class ResearchRunOrchestrator {
  private readonly searchFn: typeof SearchWebFn;
  private readonly scraper: Scraper;
  private readonly artifactsDir?: string;
  private readonly searchCred?: SearchProviderCredentials;
  private readonly saveState?: StatePersistence["saveState"];
  private readonly profileResolver: ProfileResolver;

  /** Settings context for post-processing features (PDF, mind-map). Optional for test compatibility. */
  private readonly settings?: SettingsContext;

  constructor(deps: OrchestratorDeps) {
    this.searchFn = deps.searchFn;
    this.scraper = deps.scraper;
    this.artifactsDir = deps.artifactsDir;
    this.searchCred = deps.searchCred;
    this.saveState = deps.saveState;
    this.profileResolver = deps.profileResolver;
    this.settings = deps.settings;
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
    const snapshot = ResearchStateMachine.init(artifact.plan, this.profileResolver);

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
    const rawResponse = lastAssistant?.message?.content as string | undefined;
    // Parse once — used for both draft recovery and state machine phases
    const parsedResponse = extractTextContent(rawResponse) || undefined;

    const lastStateEntry = [...entries].reverse().find((e) => e.customType === STATE_KEY);
    if (!lastStateEntry) {
      return { kind: "error", error: "no_state", details: {} };
    }

    const stateData = lastStateEntry.data as Record<string, unknown>;
    const snapshot = stateData as unknown as ResearchSnapshot;
    const plan = stateData.plan as ResearchPlan;
    const planArtifactPath = stateData.planArtifactPath as string;

    // Restore draft from encoded blob — works for any phase
    const draftEncoded = stateData.draftEncoded as string | undefined;
    snapshot.draft = draftEncoded ? ResearchDraft.decode(draftEncoded) : new ResearchDraft();

    let deepResearchBase = (stateData.deepResearchBase as string) || join(dirname(planArtifactPath), "..");
    if (!deepResearchBase.startsWith("/")) deepResearchBase = join(process.cwd(), deepResearchBase);
    const logsDir = join(deepResearchBase, "logs");
    const artifactsDir = join(deepResearchBase, "artifacts");

    if (!plan || !snapshot) {
      return { kind: "error", error: "corrupted_state", details: {} };
    }

    const machine = this.createMachine(artifactsDir);

    const result = await this.runAndPersist(machine, snapshot, plan, parsedResponse, {
      plan,
      planArtifactPath,
      deepResearchBase,
    });

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
   * Post-process a done phase: assemble report, export PDF, generate mind-map.
   * All conditional on this.settings being present (absent in test mode).
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

    const reportsDir = this.settings.reportsDir;
    const profileName =
      typeof plan.profile === "object" && "name" in plan.profile ? (plan.profile as any).name : undefined;

    const reportPath = assembleReport({
      snapshot,
      topic: plan.topic,
      reportsDir,
      planArtifactPath,
      logsDir,
      profileName,
    });

    let pdfResult: any;
    if (this.settings.pdfExport) {
      const pdfR = await convertToPdf({ reportPath });
      if (pdfR.kind === "success") {
        pdfResult = { kind: "success", outputPath: pdfR.outputPath, method: pdfR.method };
      } else if (pdfR.kind === "fallback") {
        pdfResult = { kind: "fallback", error: pdfR.error, outputPath: pdfR.outputPath };
      }
    }

    let mindMapPrompt: string | undefined;
    if (this.settings.mindMap && snapshot.allFindings.length > 0) {
      const findingsSummary = snapshot.allFindings
        .slice(0, 30)
        .map((f, i) => `${i + 1}. ${f.text.substring(0, 200)}`)
        .join("\n");
      mindMapPrompt = buildMindMapPrompt(plan.topic, findingsSummary, undefined, undefined);
    }

    // ADR-0023: append settings section if enabled
    if (this.settings.settingsReport.inReport) {
      appendFileSync(reportPath, `\n${appendSettingsSection("", this.settings)}`);
    }

    // ADR-0017: contradiction analysis — append to report if contradictions found
    const contradictions = snapshot.allFindings.filter(
      (f) => f.text.includes("CONTRADICTION") || f.text.includes("contradiction") || f.text.includes("debatable"),
    );
    let contradictionAnalysis: string | undefined;
    if (contradictions.length > 0) {
      contradictionAnalysis = [
        `## Contradictions & Debatable Facts`,
        ``,
        ...contradictions.map((f) => `- ${f.text.substring(0, 300)} [Source: ${f.sourceUrl}]`),
        ``,
      ].join("\n");
    }

    return {
      kind: "done",
      ...base,
      reportPath,
      pdfResult,
      mindMapPrompt,
      contradictionAnalysis,
    };
  }
}

/** Extract plain text from agent response (handles string and content blocks array).
 *  Strips <tool_calls>...</tool_calls> XML blocks from string input. */
export function extractTextContent(agentResponse?: unknown): string {
  if (!agentResponse) return "";
  if (typeof agentResponse === "string") {
    return agentResponse.replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, "").trim();
  }
  if (Array.isArray(agentResponse)) {
    return (agentResponse as any[])
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}
