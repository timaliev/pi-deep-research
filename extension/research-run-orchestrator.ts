import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { ResearchStateMachine } from "./state-machine.js";
import type { ResearchSnapshot } from "./state-machine.js";
import { extractTextContent } from "./state-machine.js";
import type { ResearchPlan, PrefilterArtifact } from "./prefilter.js";
import type { searchWeb as SearchWebFn } from "./search/web-search.js";
import type { Scraper } from "./scraper.js";
import type { SearchProviderCredentials } from "./search-providers.js";
import { JsonlLogger } from "./logger.js";
import { ProfileResolver } from "./profile-resolver.js";

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
}

export interface OrchestratorParams {
  planArtifactPath?: string;
  /** Session entries for state lookup (mockable). */
  entries: Array<{ customType?: string; data?: Record<string, unknown>; message?: { role?: string; content?: unknown } }>;
}

export type OrchestratorResult =
  | { kind: "error"; error: string; details?: Record<string, unknown> }
  | { kind: "in_progress"; snapshot: ResearchSnapshot; inject?: string; plan: ResearchPlan; planArtifactPath: string; deepResearchBase: string }
  | { kind: "done"; snapshot: ResearchSnapshot; plan: ResearchPlan; planArtifactPath: string; deepResearchBase: string; logsDir: string };

const STATE_KEY = "deep-research:state";

export class ResearchRunOrchestrator {
  private readonly searchFn: typeof SearchWebFn;
  private readonly scraper: Scraper;
  private readonly artifactsDir?: string;
  private readonly searchCred?: SearchProviderCredentials;
  private readonly saveState?: StatePersistence["saveState"];
  private readonly profileResolver: ProfileResolver;

  constructor(deps: OrchestratorDeps) {
    this.searchFn = deps.searchFn;
    this.scraper = deps.scraper;
    this.artifactsDir = deps.artifactsDir;
    this.searchCred = deps.searchCred;
    this.saveState = deps.saveState;
    this.profileResolver = deps.profileResolver;
  }

  async handle(params: OrchestratorParams): Promise<OrchestratorResult> {
    if (params.planArtifactPath) {
      return this.handleFirstCall(params.planArtifactPath, params.entries);
    }
    return this.handleSubsequentCall(params.entries);
  }

  private async handleFirstCall(planArtifactPath: string, entries: OrchestratorParams["entries"]): Promise<OrchestratorResult> {
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
    const machine = new ResearchStateMachine({
      searchFn: this.searchFn,
      scraper: this.scraper,
      profileResolver: this.profileResolver,
      artifactsDir,
      searchCred: this.searchCred,
      logger: runLogger,
    });

    const result = await machine.next(snapshot, artifact.plan);

    // Persist state
    this.saveState?.(result.snapshot, {
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
    const lastAssistant = [...entries].reverse().find(
      (e) => e.message?.role === "assistant"
    );
    const agentResponse = lastAssistant?.message?.content as string | undefined;

    const lastStateEntry = [...entries].reverse().find((e) => e.customType === STATE_KEY);
    if (!lastStateEntry) {
      return { kind: "error", error: "no_state", details: {} };
    }

    const stateData = lastStateEntry.data as Record<string, unknown>;
    const snapshot = stateData as unknown as ResearchSnapshot;
    const plan = stateData.plan as ResearchPlan;
    const planArtifactPath = stateData.planArtifactPath as string;

    // Restore draft only when entering drafting phase
    if (snapshot.phase === "drafting") {
      const draftReady = stateData.draftReady as boolean | undefined;
      if (draftReady) {
        const text = extractTextContent(agentResponse);
        if (text && text.length >= 40) {
          snapshot.draftReport = text;
        }
      }
    }

    let deepResearchBase = (stateData.deepResearchBase as string) || join(dirname(planArtifactPath), "..");
    if (!deepResearchBase.startsWith("/")) deepResearchBase = join(process.cwd(), deepResearchBase);
    const logsDir = join(deepResearchBase, "logs");
    const artifactsDir = join(deepResearchBase, "artifacts");

    if (!plan || !snapshot) {
      return { kind: "error", error: "corrupted_state", details: {} };
    }

    const machine = new ResearchStateMachine({
      searchFn: this.searchFn,
      scraper: this.scraper,
      profileResolver: this.profileResolver,
      artifactsDir,
      searchCred: this.searchCred,
    });

    const result = await machine.next(snapshot, plan, agentResponse);

    this.saveState?.(result.snapshot, {
      plan,
      planArtifactPath,
      deepResearchBase,
    });

    if (result.phase === "done") {
      return {
        kind: "done",
        snapshot: result.snapshot,
        plan,
        planArtifactPath,
        deepResearchBase,
        logsDir,
      };
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
}
