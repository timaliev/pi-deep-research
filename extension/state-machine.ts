import type { ResearchPlan, ResearchPlanProfile } from "./prefilter.js";
import { generateRunId } from "./ids.js";
import type { Logger } from "./logger.js";
import type { searchWeb as SearchWebFn } from "./search/web-search.js";
import type { WebSearchResult } from "./search/web-search.js";
import type { SearchEngine } from "./search/web-search.js";
import type { Scraper, ScrapedPage } from "./scraper.js";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSearchQueue, saveQueue } from "./search-queue.js";
import type { SearchProviderCredentials } from "./search-providers.js";
import { createReportStyle } from "./report-styles.js";
import type { ReportStyle } from "./report-styles.js";
import type { ProfileResolver } from "./profile-resolver.js";
import { JsonlLogger } from "./logger.js";

/** Parameters controlling research depth and breadth. */
export interface ResearchProfile {
  breadth: number;
  depth: number;
  concurrency: number;
  /** Maximum search API calls before soft limit triggers (0 = unlimited). */
  maxSearchCalls?: number;
  /** Maximum wall-clock seconds before soft limit triggers (0 = unlimited). */
  maxElapsedSeconds?: number;
}

export interface Finding {
  text: string;
  sourceUrl: string;
  citation: string;
  iteration: number;
}

export interface ResearchSnapshot {
  phase: string;
  runId: string;
  currentDepth: number;
  totalDepth: number;
  allFindings: Finding[];
  allVisitedUrls: string[];
  draftReport: string;
  reportPath: string;
  searchCalls: number;
  scrapeCalls: number;
  startedAt: number;
  softLimitTriggered: boolean;
  profile?: ResearchProfile;
  /** Follow-up questions from agent's last response (populated by questioning phase). */
  pendingQuestions?: string[];
}

export interface ResearchStateResult {
  phase: "searching" | "extracting" | "questioning" | "drafting" | "saving" | "done";
  snapshot: ResearchSnapshot;
  inject?: string;
  reportPath?: string;
  error?: string;
}

/** Simple async semaphore to limit concurrency. */
class ConcurrencySemaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

/**
 * Research state machine — advances through research phases.
 * Searches and scrapes run concurrently, limited by profile.concurrency.
 * Soft limits (maxSearchCalls, maxElapsedSeconds) reduce intensity and stop depth recursion.
 */
export interface ResearchContext {
  searchFn: typeof SearchWebFn;
  scraper: Scraper;
  profileResolver: ProfileResolver;
  artifactsDir?: string;
  searchCred?: SearchProviderCredentials;
  /** Optional logger — when provided, the machine uses it instead of creating one lazily. */
  logger?: Logger;
}

export class ResearchStateMachine {
  private readonly searchFn: typeof SearchWebFn;
  private readonly scraper: Scraper;
  private readonly profileResolver: ProfileResolver;
  private logger?: Logger;
  private readonly artifactsDir?: string;
  private readonly searchCred?: SearchProviderCredentials;
  private style?: ReportStyle;

  constructor(ctx: ResearchContext) {
    this.searchFn = ctx.searchFn;
    this.scraper = ctx.scraper;
    this.profileResolver = ctx.profileResolver;
    this.artifactsDir = ctx.artifactsDir ?? defaultArtifactsDir();
    this.searchCred = ctx.searchCred;
    this.logger = ctx.logger;
  }

  static init(plan: ResearchPlan, resolver: ProfileResolver, runId?: string): ResearchSnapshot {
    const profile = resolver.resolve(plan.profile);
    return {
      phase: "searching",
      runId: runId ?? generateRunId(),
      currentDepth: 0,
      totalDepth: profile.depth,
      allFindings: [],
      allVisitedUrls: [],
      draftReport: "",
      reportPath: "",
      searchCalls: 0,
      scrapeCalls: 0,
      startedAt: Date.now(),
      softLimitTriggered: false,
      profile,
    };
  }

  async next(snapshot: ResearchSnapshot, plan: ResearchPlan, agentResponse?: string): Promise<ResearchStateResult> {
    // Create logger lazily only if not injected via ResearchContext
    if (!this.logger) {
      const logsDir = join(this.artifactsDir!, "..", "logs");
      mkdirSync(logsDir, { recursive: true });
      this.logger = new JsonlLogger(snapshot.runId, join(logsDir, `${snapshot.runId}.log`));
    }
    if (!snapshot.profile) {
      snapshot.profile = this.profileResolver.resolve(plan.profile);
      snapshot.totalDepth = snapshot.profile.depth;
    }
    // Resolve report style once per run
    if (!this.style) {
      this.style = createReportStyle(plan.reportStyle ?? "narrative");
    }
    // Agent response already parsed by orchestrator — phase handlers receive clean text or undefined
    switch (snapshot.phase) {
      case "searching":  return this.doSearching(snapshot, plan);
      case "extracting": return this.doExtracting(snapshot, plan);
      case "questioning": return this.doQuestioning(snapshot, plan, agentResponse);
      case "drafting":   return this.doDrafting(snapshot, plan, agentResponse);
      case "saving":     return this.doSaving(snapshot, agentResponse);
      case "done":       return { phase: "done", snapshot };
    }
  }

  private checkSoftLimits(snapshot: ResearchSnapshot): void {
    const prof = snapshot.profile!;
    const elapsed = (Date.now() - snapshot.startedAt) / 1000;
    const maxCalls = prof.maxSearchCalls ?? 0;
    const maxSec = prof.maxElapsedSeconds ?? 0;
    if (
      !snapshot.softLimitTriggered &&
      ((maxCalls > 0 && snapshot.searchCalls >= maxCalls) ||
       (maxSec > 0 && elapsed >= maxSec))
    ) {
      snapshot.softLimitTriggered = true;
      this.logger?.event("soft_limit_triggered", {
        searchCalls: snapshot.searchCalls,
        maxSearchCalls: maxCalls,
        elapsedSeconds: Math.round(elapsed),
        maxElapsedSeconds: maxSec,
      });
    }
  }

  private async doSearching(
    snapshot: ResearchSnapshot,
    plan: ResearchPlan
  ): Promise<ResearchStateResult> {
    const prof = snapshot.profile!;
    // Use plan research questions for iteration 0, agent's follow-up questions for later iterations
    const questions =
      snapshot.pendingQuestions && snapshot.pendingQuestions.length > 0
        ? snapshot.pendingQuestions
        : plan.researchQuestions;
    // Clear so they aren't reused
    snapshot.pendingQuestions = undefined;

    // When soft-limited: fewer queries, fewer results per query
    const maxResultsPerQuery = snapshot.softLimitTriggered ? 2 : 3;
    const breadth = snapshot.softLimitTriggered
      ? Math.min(2, prof.breadth)
      : prof.breadth;

    const activeQuestions = questions.slice(0, breadth);
    const semaphore = new ConcurrencySemaphore(prof.concurrency);
    const newVisited = new Set(snapshot.allVisitedUrls);
    const engines = plan.engines;

    // Build and save search request queue for post-mortem analysis
    const queue = buildSearchQueue(activeQuestions, engines.length > 0 ? engines : ["duckduckgo"]);
    if (this.artifactsDir) {
      try {
        saveQueue(queue, join(this.artifactsDir, `queue-${snapshot.runId}-d${snapshot.currentDepth}.json`));
        this.logger?.event("queue_saved", {
          depth: snapshot.currentDepth,
          entries: queue.length,
          engines: engines.join(","),
        });
      } catch { /* non-critical */ }
    }

    // Concurrent searches (pass logger but credentials come from env/settings per-engine)
    const searchResults = await Promise.all(
      activeQuestions.map((question) =>
        semaphore.run(async () => {
          const startMs = Date.now();
          const results = await this.searchFn(question, maxResultsPerQuery, engines, { logger: this.logger, credentials: this.searchCred });
          this.logger?.event("search_executed", {
            query: question,
            resultCount: results.length,
            elapsedMs: Date.now() - startMs,
            depth: snapshot.currentDepth,
          });
          snapshot.searchCalls++;
          return { question, results };
        })
      )
    );

    // Collect URLs for scraping
    const urlsToScrape: string[] = [];
    for (const { results } of searchResults) {
      for (const r of results.slice(0, 2)) {
        if (!newVisited.has(r.url)) {
          urlsToScrape.push(r.url);
          newVisited.add(r.url);
        }
      }
    }

    // Concurrent scrapes
    const scrapedResults = await Promise.all(
      urlsToScrape.map((url) =>
        semaphore.run(async () => {
          try {
            const startMs = Date.now();
            const page = await this.scraper.scrape(url);
            this.logger?.event("scrape_executed", {
              url,
              title: page.title,
              bytes: page.content.length,
              elapsedMs: Date.now() - startMs,
              depth: snapshot.currentDepth,
            });
            snapshot.scrapeCalls++;
            return page;
          } catch (err: any) {
            this.logger?.event("scrape_failed", { url, error: err.message, depth: snapshot.currentDepth });
            return null;
          }
        })
      )
    );

    const scraped: ScrapedPage[] = scrapedResults.filter(
      (p): p is ScrapedPage => p !== null
    );

    const nextDepth = snapshot.currentDepth + 1;
    const nextSnapshot: ResearchSnapshot = {
      ...snapshot,
      phase: "extracting",
      currentDepth: nextDepth,
      allVisitedUrls: [...newVisited],
    };

    // Check soft limits after this round's searches
    this.checkSoftLimits(nextSnapshot);

    const style = this.style!;
    const inject = style.buildExtractionPrompt(searchResults, scraped, nextDepth, snapshot.totalDepth);
    this.logger?.event("phase_changed", { from: "searching", to: "extracting", depth: nextDepth });
    this.logger?.event("inject_sent", { type: "extraction", length: inject.length, depth: nextDepth });
    return { phase: "extracting", snapshot: nextSnapshot, inject };
  }

  private doExtracting(snapshot: ResearchSnapshot, plan: ResearchPlan): ResearchStateResult {
    const nextPhase = phaseRouter(snapshot);
    if (nextPhase === "questioning") {
      return this.doQuestioningInject(snapshot, plan);
    }
    this.logger?.event("deepening_skipped", {
      reason: snapshot.softLimitTriggered ? "soft_limit" : "depth_reached",
      currentDepth: snapshot.currentDepth,
      totalDepth: snapshot.totalDepth,
    });
    return this.doDraftingInject(snapshot, plan);
  }

  private doQuestioningInject(snapshot: ResearchSnapshot, plan: ResearchPlan): ResearchStateResult {
    const inject = this.style!.buildQuestioningPrompt(plan, snapshot.currentDepth, snapshot.totalDepth);
    this.logger?.event("phase_changed", { from: "extracting", to: "questioning", depth: snapshot.currentDepth });
    this.logger?.event("inject_sent", { type: "deepening", length: inject.length, depth: snapshot.currentDepth });
    return { phase: "questioning", snapshot: { ...snapshot, phase: "questioning" }, inject };
  }

  private doDraftingInject(snapshot: ResearchSnapshot, plan: ResearchPlan): ResearchStateResult {
    const inject = this.style!.buildDraftingPrompt(plan, snapshot.allFindings);
    this.logger?.event("phase_changed", { from: "extracting", to: "drafting", depth: snapshot.currentDepth });
    this.logger?.event("inject_sent", { type: "drafting", length: inject.length });
    return { phase: "drafting", snapshot: { ...snapshot, phase: "drafting" }, inject };
  }

  private async doQuestioning(snapshot: ResearchSnapshot, plan: ResearchPlan, parsedResponse?: string): Promise<ResearchStateResult> {
    if (parsedResponse) {
      const questions = this.extractQuestions(parsedResponse);
      snapshot.pendingQuestions = questions.length > 0 ? questions : plan.researchQuestions;
    } else {
      snapshot.pendingQuestions = plan.researchQuestions;
    }
    const searchSnapshot: ResearchSnapshot = { ...snapshot, phase: "searching" };
    return this.doSearching(searchSnapshot, plan);
  }

  private extractQuestions(text: string): string[] {
    const lines = text.split("\n");
    const questions: string[] = [];
    for (const line of lines) {
      const match = line.match(/^\s*\d+[.)]\s+(.+)/);
      if (match && match[1].trim().length > 10) {
        questions.push(match[1].trim());
      }
    }
    return questions;
  }

  private doDrafting(snapshot: ResearchSnapshot, plan: ResearchPlan, parsedResponse?: string): ResearchStateResult {
    const reportText = parsedResponse ?? "";
    this.logger?.event("drafting_extracted", { textLength: reportText.length, agentResponseType: "string" });
    if (!reportText || reportText.length < 40) {
      // Agent didn't produce a proper report — re-inject drafting prompt
      const inject = this.style!.buildDraftingPrompt(plan, snapshot.allFindings);
      this.logger?.event("drafting_retry", { reason: "empty_response", length: reportText?.length ?? 0 });
      return {
        phase: "drafting",
        snapshot: { ...snapshot, phase: "drafting" },
        inject: `⚠️ No report text in your response.\n\n**Write the report as your response text. Do NOT call run_research or any other tools.** After you write the complete report, then call run_research.\n\n${inject}`,
      };
    }
    this.logger?.event("phase_changed", { from: "drafting", to: "saving" });
    return {
      phase: "saving",
      snapshot: { ...snapshot, phase: "saving", draftReport: reportText },
    };
  }

  private doSaving(snapshot: ResearchSnapshot, parsedResponse?: string): ResearchStateResult {
    let text = snapshot.draftReport ?? "";
    // Fallback: if draft was stripped by session persistence, re-extract from parsed response
    if (text.length < 40 && parsedResponse !== undefined) {
      text = parsedResponse;
    }
    if (text.length < 40) {
      this.logger?.event("saving_blocked", { reason: "empty_draft", draftLength: text.length });
      return { phase: "saving", snapshot };
    }
    this.logger?.event("phase_changed", { from: "saving", to: "done", draftLength: text.length });
    return { phase: "done", snapshot: { ...snapshot, phase: "done", draftReport: text } };
  }
}

/** Pure function: decide next phase after extraction. Returns "questioning" or "drafting". */
export function phaseRouter(snapshot: ResearchSnapshot): "questioning" | "drafting" {
  const shouldDeepen = !snapshot.softLimitTriggered && snapshot.currentDepth < snapshot.totalDepth;
  return shouldDeepen ? "questioning" : "drafting";
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


const stateMachineDir = dirname(fileURLToPath(import.meta.url));
const defaultArtifactsDir = () => join(stateMachineDir, "..", "..", "deep-research", "artifacts");
