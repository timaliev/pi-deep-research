import { generateRunId } from "./ids.js";
import type { Logger } from "./logger.js";
import type { searchWeb as SearchWebFn } from "./search/web-search.js";
import type { WebSearchResult } from "./search/web-search.js";
import type { SearchEngine } from "./search/web-search.js";
import type { Scraper, ScrapedPage } from "./scraper.js";
import { resolveProfile, DEFAULT_PRESETS } from "./state-machine.js";
import type { ProfileResolver } from "./profile-resolver.js";

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
  private readonly profileResolver?: ProfileResolver;

  constructor(
    searchFn: typeof SearchWebFn,
    scraper: Scraper,
    artifactsDir: string,
    logger?: Logger,
    profileResolver?: ProfileResolver,
  ) {
    this.searchFn = searchFn;
    this.scraper = scraper;
    this.artifactsDir = artifactsDir;
    this.logger = logger;
    this.profileResolver = profileResolver;
  }

  /** Step 1: Ask agent to propose engines + profile. */
  async start(topic: string): Promise<PrefilterResult> {
    const runId = generateRunId();
    this.logger?.event("prefilter_started", { topic });
    const inject = this.buildParamsPrompt(topic);
    return { phase: "awaiting_params", runId, inject };
  }

  /** Step 2: Agent chose engines + profile. Prelim search, ask for full plan. */
  async withParams(topic: string, engines: SearchEngine[], profile: ResearchPlanProfile): Promise<PrefilterResult> {
    const runId = generateRunId();
    this.logger?.event("prefilter_params_set", { engines, profile });

    const missingKeys = this.checkApiKeys(engines);
    if (missingKeys.length > 0) {
      const inject = this.buildApiKeyWarning(missingKeys);
      return { phase: "awaiting_params", runId, inject, engines, profile };
    }

    const searchQuery = this.buildSearchQuery(topic);
    const searchResults = await this.searchFn(searchQuery, 3, engines, { logger: this.logger });

    const scrapedContent: ScrapedPage[] = [];
    for (const result of searchResults.slice(0, 2)) {
      try {
        const page = await this.scraper.scrape(result.url);
        scrapedContent.push(page);
      } catch { /* skip */ }
    }

    const inject = this.buildPlanPrompt(topic, engines, profile, searchResults, scrapedContent);
    return { phase: "awaiting_plan", runId, inject, engines, profile, searchResults, scrapedContent };
  }

  /**
   * Second call: validate agent's JSON plan and save as artifact.
   */
  async finalize(
    topic: string,
    planJson: string
  ): Promise<PrefilterResult> {
    const runId = generateRunId();

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
        query: this.buildSearchQuery(topic),
        resultsCount: 0,
        scrapedUrls: [],
      },
    };

    const fileName = `${runId}-prefilter.json`;
    const artifactPath = path.join(this.artifactsDir, fileName);
    await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf-8");

    this.logger?.event("plan_saved", { artifactPath, questions: plan.researchQuestions.length });

    return {
      phase: "plan_ready",
      runId,
      planArtifactPath: artifactPath,
      plan,
    };
  }

  private buildSearchQuery(topic: string): string {
    // Normalize topic into a web search query
    return topic.trim().replace(/\s+/g, " ").substring(0, 300);
  }

  private validatePlan(plan: unknown): string | null {
    if (!plan || typeof plan !== "object") return "Plan must be a JSON object";
    const p = plan as Record<string, unknown>;

    if (!p.topic || typeof p.topic !== "string" || !p.topic.trim()) return "Plan must include 'topic'";
    if (!p.goal || typeof p.goal !== "string" || !p.goal.trim()) return "Plan must include 'goal'";
    if (!Array.isArray(p.researchQuestions) || p.researchQuestions.length === 0) return "Plan must include researchQuestions";
    if (!Array.isArray(p.engines) || p.engines.length === 0) return "Plan must include 'engines' array with at least one engine";
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
    if (!prof.name || !["default","fast","deep","custom"].includes(prof.name as string)) {
      return "profile.name must be default, fast, deep, or custom";
    }
    if (prof.name === "custom") {
      if (typeof prof.breadth !== "number" || (prof.breadth as number) < 1) return "Custom profile must include 'breadth' >= 1";
      if (typeof prof.depth !== "number" || (prof.depth as number) < 1) return "Custom profile must include 'depth' >= 1";
    }

    return null;
  }

  private checkApiKeys(engines: SearchEngine[]): string[] {
    const missing: string[] = [];
    if (engines.includes("brave") && !process.env.BRAVE_API_KEY) missing.push("BRAVE_API_KEY");
    if (engines.includes("tavily") && !process.env.TAVILY_API_KEY) missing.push("TAVILY_API_KEY");
    if (engines.includes("yandex") && (!process.env.YANDEX_OAUTH_TOKEN || !process.env.YANDEX_FOLDER_ID))
      missing.push("YANDEX_OAUTH_TOKEN, YANDEX_FOLDER_ID");
    return missing;
  }

  private buildParamsPrompt(topic: string): string {
    const presets = this.profileResolver
      ? Object.entries(this.profileResolver.getPresets())
          .map(([name, p]) => `  ${name}: breadth=${p.breadth}, depth=${p.depth}, concurrency=${p.concurrency}`)
          .join("\n")
      : Object.entries(DEFAULT_PRESETS)
          .map(([name, p]) => `  ${name}: breadth=${p.breadth}, depth=${p.depth}, concurrency=${p.concurrency}`)
          .join("\n");
    const defaultName = this.profileResolver?.defaultProfileName ?? "default";
    return `## Research Parameters\n\nTopic: ${topic}\n\nChoose search engines, profile, and report style. Reply with JSON:\n\`\`\`json\n{"engines":["duckduckgo"],"profile":{"name":"${defaultName}"},"reportStyle":"narrative"}\n\`\`\`\n\nEngines: duckduckgo (free), brave (needs BRAVE_API_KEY), tavily (needs TAVILY_API_KEY), yandex (needs YANDEX_OAUTH_TOKEN+YANDEX_FOLDER_ID), searxng (public).\n\nAvailable profiles (default: **${defaultName}**):\n${presets}\n  custom: specify breadth, depth, concurrency\n\nReport styles:\n  narrative — fixed 5-section template (Introduction/Findings/Analysis/Recommendations/Sources)\n  subtopics — LLM discovers 5–10 thematic sections from findings\n\nYou may change the profile or report style later during plan creation.`;
  }

  private buildApiKeyWarning(missing: string[]): string {
    return `## API Key Required\n\nMissing: ${missing.join(", ")}. Set env vars and retry, or switch to duckduckgo.`;
  }

  private buildPlanPrompt(
    topic: string, engines: SearchEngine[], profile: ResearchPlanProfile,
    searchResults: WebSearchResult[], scrapedContent: ScrapedPage[],
  ): string {
    const resolved = this.profileResolver
      ? this.profileResolver.resolve(profile)
      : resolveProfile(profile);
    const profileNames = this.profileResolver
      ? this.profileResolver.listNames().join("/")
      : "default/fast/deep";
    let p = `## Research Planning\n\nTopic: ${topic}\nEngines: [${engines.join(", ")}]\nProfile: ${profile.name} (breadth=${resolved.breadth}, depth=${resolved.depth}, concurrency=${resolved.concurrency})\n\nYou may change the profile in the plan JSON — use any named preset (${profileNames}) or custom with breadth/depth/concurrency. Pick the profile that best fits this research.\n\n### Preliminary Search\n\n`;
    for (const r of searchResults) p += `- [${r.title}](${r.url}): ${r.snippet}\n`;
    if (scrapedContent.length > 0) {
      p += `\n### Scraped Content\n\n`;
      for (const sp of scrapedContent) p += `**${sp.title}** (${sp.url})\n\n${sp.content.substring(0, 800)}\n\n---\n`;
    }
    p += `\n### Instructions\n\nProduce research plan JSON:
\`\`\`json\n{"topic":"${topic}","goal":"...","researchQuestions":["Q1"],"engines":${JSON.stringify(engines)},"profile":${JSON.stringify(profile)},"scope":{"include":"...","exclude":"..."},"estimatedCost":{"searchCalls":12,"scrapeCalls":8,"description":"~12 searches"}}\n\`\`\`\n\nSet reportStyle to \"narrative\" (fixed 5-section) or \"subtopics\" (LLM discovers thematic sections). Output ONLY JSON.`;
    return p;
  }
}
