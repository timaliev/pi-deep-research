import { join } from "node:path";
import { generateRunId } from "./ids.js";
import type { Logger } from "./logger.js";
import { JsonlLogger } from "./logger.js";
import {
  buildApiKeyWarning,
  buildEngineStatus,
  buildIntrospectionPrompt,
  buildMergePrompt,
  buildParamsPrompt,
  buildPlanPrompt,
  buildSearchQuery,
} from "./prefilter-prompts.js";
import { ProfileResolver } from "./profile-resolver.js";
import type { ScrapedPage, Scraper } from "./scraper.js";
import { WebScraper } from "./scraper.js";
import type { SearchEngine, searchWeb as SearchWebFn, WebSearchResult } from "./search/web-search.js";
import { searchWeb } from "./search/web-search.js";
import type { SearchProviderCredentials } from "./settings-context.js";
import { PREFILTER_RUN_KEY } from "./session-state.js";

/** Filter engines against the allowlist. If none survive, fall back to defaults. Logs warnings when engines are dropped. */
function enforceEngineAllowlist(
  engines: SearchEngine[],
  enabledEngines: string[] | undefined,
  logger?: Logger,
): SearchEngine[] {
  if (!enabledEngines || enabledEngines.length === 0) return engines;
  const filtered = engines.filter((e) => enabledEngines.includes(e));
  const dropped = engines.filter((e) => !enabledEngines.includes(e));
  if (dropped.length > 0) {
    logger?.event("engines_filtered", { dropped, allowed: filtered, allowlist: enabledEngines });
  }
  if (filtered.length === 0) {
    logger?.event("engines_all_filtered", { original: engines, allowlist: enabledEngines, fallback: "duckduckgo" });
    return ["duckduckgo"];
  }
  return filtered;
}

export interface ResearchPlanProfile {
  name: "default" | "fast" | "deep" | "custom";
  breadth?: number;
  depth?: number;
  concurrency?: number;
}

export interface ResearchPlan {
  topic: string;
  goal: string;
  researchQuestions: string[];
  /** Search engines for this run. */
  engines: SearchEngine[];
  /** Profile controlling depth/breadth. */
  profile: ResearchPlanProfile;
  /** Report generation style: narrative (5-section) or subtopics (LLM discovers themes). */
  reportStyle?: "narrative" | "subtopics";
  /** Allowed search engines for this run (frozen from settings at plan time). */
  enabledEngines?: string[];
  /** ADR-0017: metadata about each research question (source, confidence, importance). */
  questionMetadata?: Record<
    string,
    {
      source: "web" | "internal" | "both";
      confidence: "low" | "medium" | "high";
      importance: "critical" | "important" | "supplementary";
      contradictionOf?: string;
      debatableFact?: string;
    }
  >;
  scope: {
    include: string;
    exclude: string;
  };
  estimatedCost: {
    searchCalls: number;
    scrapeCalls: number;
    description: string;
  };
}

export interface PrefilterArtifact {
  version: 1;
  runId: string;
  createdAt: string; // ISO 8601
  inputTopic: string;
  plan: ResearchPlan;
  preliminarySearch: {
    query: string;
    resultsCount: number;
    scrapedUrls: string[];
  };
}

export interface PrefilterResult {
  phase: "awaiting_params" | "awaiting_plan" | "plan_ready" | "error";
  runId: string;
  planArtifactPath?: string;
  searchResults?: WebSearchResult[];
  scrapedContent?: ScrapedPage[];
  engines?: SearchEngine[];
  profile?: ResearchPlanProfile;
  plan?: ResearchPlan;
  inject?: string;
  error?: string;
}

/** Bundled dependencies for PrefilterManager and PrefilterSession (ADR-0024). */
export interface PrefilterContext {
  searchFn: typeof SearchWebFn;
  scraper: Scraper;
  artifactsDir: string;
  logger?: Logger;
  profileResolver?: ProfileResolver;
  searchCred?: SearchProviderCredentials;
  defaultReportStyle?: "narrative" | "subtopics";
  enabledEngines?: string[];
}

/**
 * Manages the research prefilter workflow:
 * 1. Preliminary search + scrape
 * 2. Agent generates a JSON research plan
 * 3. Validation and persistence of the plan artifact
 */
export class PrefilterManager {
  private readonly searchFn: typeof SearchWebFn;
  private readonly scraper: Scraper;
  private readonly artifactsDir: string;
  private readonly logger?: Logger;
  private readonly profileResolver: ProfileResolver;
  private readonly searchCred?: SearchProviderCredentials;
  private readonly sharedRunId?: string;
  private readonly defaultReportStyle: "narrative" | "subtopics";
  private readonly enabledEngines?: string[];
  private lastSearchResultCount = 0;
  private lastScrapedUrls: string[] = [];
  private finalized = false;
  private prefilterPhase: "awaiting_params" | "awaiting_plan" | "introspecting" | "merging" = "awaiting_params";
  private llmTopics?: string;

  constructor(ctx: PrefilterContext, sharedRunId?: string) {
    this.searchFn = ctx.searchFn;
    this.scraper = ctx.scraper;
    this.artifactsDir = ctx.artifactsDir;
    this.logger = ctx.logger;
    this.profileResolver = ctx.profileResolver ?? new ProfileResolver({}, "default");
    this.searchCred = ctx.searchCred;
    this.sharedRunId = sharedRunId;
    this.defaultReportStyle = ctx.defaultReportStyle ?? "narrative";
    this.enabledEngines = ctx.enabledEngines;
  }

  private runId(): string {
    return this.sharedRunId ?? generateRunId();
  }

  // Cache for withParams reuse in continue()
  private cachedTopic?: string;
  private cachedEngines?: SearchEngine[];
  private cachedProfile?: ResearchPlanProfile;

  /**
   * Handle a zero-params call — dispatches by prefilter phase.
   * Called by the plan_research tool when no params_json or plan_json are provided.
   */
  async continue(topic?: string, llmResponse?: string): Promise<PrefilterResult> {
    // Phase: awaiting_params + topic → behave like start()
    if (topic && this.prefilterPhase === "awaiting_params") {
      return this.start(topic);
    }

    // Phase: awaiting_plan → inject introspection prompt (ADR-0017)
    if (this.prefilterPhase === "awaiting_plan") {
      this.prefilterPhase = "introspecting";
      const inject = buildIntrospectionPrompt(this.cachedTopic ?? topic ?? "");
      return { phase: "awaiting_plan", runId: this.runId(), inject };
    }

    // Phase: introspecting → run search + merge
    if (this.prefilterPhase === "introspecting") {
      this.prefilterPhase = "merging";
      if (llmResponse) {
        this.llmTopics = llmResponse;
      }
      return this.doMergeStep();
    }

    // No valid phase → error
    return { phase: "error", runId: this.runId(), error: "No topic provided and no cached prefilter state." };
  }

  /** Run preliminary search and inject merge prompt (ADR-0017). */
  private async doMergeStep(): Promise<PrefilterResult> {
    if (!this.cachedTopic || !this.cachedEngines) {
      return { phase: "error", runId: this.runId(), error: "No cached params for merge step." };
    }
    const searchQuery = buildSearchQuery(this.cachedTopic);
    const searchResults = await this.searchFn(
      searchQuery,
      5,
      this.cachedEngines.length > 0 ? this.cachedEngines[0] : "duckduckgo",
    );
    this.lastSearchResultCount = searchResults.length;
    const inject = buildMergePrompt(this.cachedTopic, this.llmTopics ?? "", searchResults);
    return { phase: "awaiting_plan", runId: this.runId(), inject, searchResults };
  }

  /** Original continue() for backward compat (no introspection). @deprecated */

  /** Step 1: Ask agent to propose engines + profile. */
  async start(topic: string): Promise<PrefilterResult> {
    this.prefilterPhase = "awaiting_params";
    const runId = this.runId();
    this.logger?.event("prefilter_started", { topic });
    const inject = buildParamsPrompt(
      topic,
      this.profileResolver.getPresets(),
      this.profileResolver?.defaultProfileName ?? "default",
      buildEngineStatus(this.searchCred, this.enabledEngines),
      this.defaultReportStyle,
    );
    return { phase: "awaiting_params", runId, inject };
  }

  /** Step 2: Agent chose engines + profile. Prelim search, ask for full plan. */
  async withParams(topic: string, engines: SearchEngine[], profile: ResearchPlanProfile): Promise<PrefilterResult> {
    this.prefilterPhase = "awaiting_plan";
    const runId = this.runId();
    this.logger?.event("prefilter_params_set", { engines, profile });

    // Cache for continue() to route to search+merge later
    this.cachedTopic = topic;
    this.cachedEngines = engines;
    this.cachedProfile = profile;

    // Enforce enabledEngines allowlist — agent may propose disabled engines
    engines = enforceEngineAllowlist(engines, this.enabledEngines, this.logger);

    const missingKeys = this.checkApiKeys(engines);
    if (missingKeys.length > 0) {
      const inject = buildApiKeyWarning(missingKeys);
      return { phase: "awaiting_params", runId, inject, engines, profile };
    }

    const searchQuery = buildSearchQuery(topic);
    const searchResults = await this.searchFn(searchQuery, 3, engines, {
      logger: this.logger,
      credentials: this.searchCred,
    });
    this.lastSearchResultCount = searchResults.length;

    const scrapedContent: ScrapedPage[] = [];
    this.lastScrapedUrls = [];
    for (const result of searchResults.slice(0, 2)) {
      try {
        const page = await this.scraper.scrape(result.url);
        scrapedContent.push(page);
        this.lastScrapedUrls.push(result.url);
      } catch {
        /* skip */
      }
    }

    const resolved = this.profileResolver.resolve(profile);
    const inject = buildPlanPrompt({
      topic,
      engines,
      profileName: profile.name,
      resolvedBreadth: resolved.breadth,
      resolvedDepth: resolved.depth,
      resolvedConcurrency: resolved.concurrency,
      presets: this.profileResolver.getPresets(),
      searchResults,
      scrapedContent,
    });
    return { phase: "awaiting_plan", runId, inject, engines, profile, searchResults, scrapedContent };
  }

  /**
   * Second call: validate agent's JSON plan and save as artifact.
   */
  async finalize(topic: string, planJson: string): Promise<PrefilterResult> {
    if (this.finalized) {
      return {
        phase: "error",
        runId: this.runId(),
        error: "Prefilter already finalized — plan_research called twice with plan_json",
      };
    }
    const runId = this.runId();

    // Parse JSON
    let plan: ResearchPlan;
    try {
      plan = JSON.parse(planJson);
    } catch {
      this.logger?.event("plan_error", { reason: "invalid_json" });
      return {
        phase: "error",
        runId,
        error: "Failed to parse plan JSON. Ensure valid JSON syntax.",
      };
    }

    // Validate required fields
    const validationError = this.validatePlan(plan);
    if (validationError) {
      this.logger?.event("plan_error", { reason: "validation", error: validationError });
      return { phase: "error", runId, error: validationError };
    }

    // Enforce engine allowlist on the plan — freeze at plan time
    plan.engines = enforceEngineAllowlist(plan.engines, this.enabledEngines, this.logger);
    plan.enabledEngines = this.enabledEngines;
    // Expand to include all enabled engines the agent didn't explicitly exclude
    if (this.enabledEngines && this.enabledEngines.length > 0) {
      const missing = this.enabledEngines.filter((e) => !plan.engines.includes(e as SearchEngine));
      if (missing.length > 0) {
        plan.engines = [...plan.engines, ...(missing as SearchEngine[])];
        this.logger?.event("engines_expanded", { added: missing, final: plan.engines });
      }
    }

    // Save artifact
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    await fs.mkdir(this.artifactsDir, { recursive: true });

    const artifact: PrefilterArtifact = {
      version: 1,
      runId,
      createdAt: new Date().toISOString(),
      inputTopic: topic,
      plan,
      preliminarySearch: {
        query: buildSearchQuery(topic),
        resultsCount: this.lastSearchResultCount,
        scrapedUrls: this.lastScrapedUrls,
      },
    };

    const fileName = `${runId}-prefilter.json`;
    const artifactPath = path.join(this.artifactsDir, fileName);
    await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf-8");
    this.finalized = true;

    this.logger?.event("plan_saved", { artifactPath, questions: plan.researchQuestions.length });

    return {
      phase: "plan_ready",
      runId,
      planArtifactPath: artifactPath,
      plan,
    };
  }

  private validatePlan(plan: unknown): string | null {
    if (!plan || typeof plan !== "object") return "Plan must be a JSON object";
    const p = plan as Record<string, unknown>;

    if (!p.topic || typeof p.topic !== "string" || !p.topic.trim()) return "Plan must include 'topic'";
    if (!p.goal || typeof p.goal !== "string" || !p.goal.trim()) return "Plan must include 'goal'";
    if (!Array.isArray(p.researchQuestions) || p.researchQuestions.length === 0)
      return "Plan must include researchQuestions";
    if (!Array.isArray(p.engines) || p.engines.length === 0)
      return "Plan must include 'engines' array with at least one engine";
    if (!p.scope || typeof p.scope !== "object") return "Plan must include 'scope'";
    if (!p.estimatedCost || typeof p.estimatedCost !== "object") return "Plan must include 'estimatedCost'";
    if (!p.profile || typeof p.profile !== "object") return "Plan must include 'profile'";

    // Validate reportStyle if present
    if (p.reportStyle !== undefined) {
      if (typeof p.reportStyle !== "string" || !["narrative", "subtopics"].includes(p.reportStyle as string)) {
        return "reportStyle must be 'narrative' or 'subtopics'";
      }
    }

    const prof = p.profile as Record<string, unknown>;
    const validNames = [...this.profileResolver.listNames(), "custom"];
    if (!prof.name || !validNames.includes(prof.name as string)) {
      return `profile.name must be one of: ${validNames.join(", ")}`;
    }
    if (prof.name === "custom") {
      if (typeof prof.breadth !== "number" || (prof.breadth as number) < 1)
        return "Custom profile must include 'breadth' >= 1";
      if (typeof prof.depth !== "number" || (prof.depth as number) < 1)
        return "Custom profile must include 'depth' >= 1";
    }

    return null;
  }

  private checkApiKeys(engines: SearchEngine[]): string[] {
    const cred = this.searchCred;
    const missing: string[] = [];
    if (engines.includes("brave") && !cred?.get("brave", "apiKey") && !process.env.BRAVE_API_KEY)
      missing.push("BRAVE_API_KEY");
    if (engines.includes("tavily") && !cred?.get("tavily", "apiKey") && !process.env.TAVILY_API_KEY)
      missing.push("TAVILY_API_KEY");
    if (engines.includes("yandex")) {
      const hasToken = cred?.get("yandex", "oauthToken") || process.env.YANDEX_OAUTH_TOKEN;
      const hasFolder = cred?.get("yandex", "folderId") || process.env.YANDEX_FOLDER_ID;
      if (!hasToken || !hasFolder) missing.push("YANDEX_OAUTH_TOKEN, YANDEX_FOLDER_ID");
    }
    return missing;
  }
}

/** Manages PrefilterManager lifecycle across tool invocations. */
export class PrefilterSession {
  private managers = new Map<string, PrefilterManager>();

  constructor(private readonly ctx: PrefilterContext) {}

  /** Get existing manager or create a new one. Session entry lookup handled internally. */
  getOrCreate(
    topic: string,
    sessionEntries: Array<{ customType?: string; data?: unknown }>,
    persist: (runId: string) => void,
  ): PrefilterManager {
    const prefilterEntry = [...sessionEntries].reverse().find((e: any) => e.customType === PREFILTER_RUN_KEY);
    const existingRunId = prefilterEntry?.data?.runId as string | undefined;

    if (existingRunId && this.managers.has(existingRunId)) {
      return this.managers.get(existingRunId)!;
    }

    // New prefilter session — clear stale managers
    this.managers.clear();
    const runId = generateRunId();
    const logsDir = join(this.ctx.artifactsDir, "..", "logs");
    const logger = new JsonlLogger(runId, join(logsDir, `${runId}-prefilter.log`));
    const manager = new PrefilterManager({ ...this.ctx, logger }, runId);
    this.managers.set(runId, manager);
    persist(runId);
    return manager;
  }

  remove(runId: string): void {
    this.managers.delete(runId);
  }
}
