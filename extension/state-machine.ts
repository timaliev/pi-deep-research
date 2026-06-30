import type { ResearchPlan, ResearchPlanProfile } from "./prefilter.js";
import { generateRunId } from "./ids.js";
import type { Logger } from "./logger.js";
import type { searchWeb as SearchWebFn } from "./search/web-search.js";
import type { WebSearchResult } from "./search/web-search.js";
import type { SearchEngine } from "./search/web-search.js";
import type { Scraper, ScrapedPage } from "./scraper.js";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSearchQueue, saveQueue } from "./search-queue.js";
import type { SearchProviderCredentials } from "./search-providers.js";
import { createReportStyle } from "./report-styles.js";
import { DEFAULT_PRESETS, resolveProfile } from "./profile-resolver.js";
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
  profilePresets?: Record<string, ResearchProfile>;
  artifactsDir?: string;
  searchCred?: SearchProviderCredentials;
}

export class ResearchStateMachine {
  private readonly searchFn: typeof SearchWebFn;
  private readonly scraper: Scraper;
  private readonly profilePresets?: Record<string, ResearchProfile>;
  private logger?: Logger;
  private readonly artifactsDir?: string;
  private readonly searchCred?: SearchProviderCredentials;

  constructor(ctx: ResearchContext) {
    this.searchFn = ctx.searchFn;
    this.scraper = ctx.scraper;
    this.profilePresets = ctx.profilePresets;
    this.artifactsDir = ctx.artifactsDir ?? defaultArtifactsDir();
    this.searchCred = ctx.searchCred;
  }

  static init(plan: ResearchPlan, presets?: Record<string, ResearchProfile>): ResearchSnapshot {
    const profile = resolveProfile(plan.profile, presets);
    return {
      phase: "searching",
      runId: generateRunId(),
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
    // Create logger lazily on first call
    if (!this.logger) {
      const logsDir = join(this.artifactsDir!, "..", "logs");
      mkdirSync(logsDir, { recursive: true });
      this.logger = new JsonlLogger(snapshot.runId, join(logsDir, `${snapshot.runId}.log`));
    }
    if (!snapshot.profile) {
      snapshot.profile = resolveProfile(plan.profile, this.profilePresets);
      snapshot.totalDepth = snapshot.profile.depth;
    }
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

    const style = createReportStyle(plan.reportStyle ?? "narrative");
    const inject = style.buildExtractionPrompt(searchResults, scraped, nextDepth, snapshot.totalDepth);
    this.logger?.event("phase_changed", { from: "searching", to: "extracting", depth: nextDepth });
    this.logger?.event("inject_sent", { type: "extraction", length: inject.length, depth: nextDepth });
    return { phase: "extracting", snapshot: nextSnapshot, inject };
  }

  private doExtracting(snapshot: ResearchSnapshot, plan: ResearchPlan): ResearchStateResult {
    // Soft limit: stop deepening, go straight to drafting
    const shouldDeepen = !snapshot.softLimitTriggered && snapshot.currentDepth < snapshot.totalDepth;
    if (shouldDeepen) {
    const inject = createReportStyle(plan.reportStyle ?? "narrative").buildQuestioningPrompt(plan, snapshot.currentDepth, snapshot.totalDepth);
      this.logger?.event("phase_changed", { from: "extracting", to: "questioning", depth: snapshot.currentDepth });
      this.logger?.event("inject_sent", { type: "deepening", length: inject.length, depth: snapshot.currentDepth });
      return { phase: "questioning", snapshot: { ...snapshot, phase: "questioning" }, inject };
    }
    this.logger?.event("deepening_skipped", {
      reason: snapshot.softLimitTriggered ? "soft_limit" : "depth_reached",
      currentDepth: snapshot.currentDepth,
      totalDepth: snapshot.totalDepth,
    });
    const inject = createReportStyle(plan.reportStyle ?? "narrative").buildDraftingPrompt(plan, snapshot.allFindings);
    this.logger?.event("phase_changed", { from: "extracting", to: "drafting", depth: snapshot.currentDepth });
    this.logger?.event("inject_sent", { type: "drafting", length: inject.length });
    return { phase: "drafting", snapshot: { ...snapshot, phase: "drafting" }, inject };
  }

  private async doQuestioning(snapshot: ResearchSnapshot, plan: ResearchPlan, agentResponse?: unknown): Promise<ResearchStateResult> {
    if (agentResponse) {
      const text = typeof agentResponse === "string"
        ? agentResponse
        : (Array.isArray(agentResponse) ? (agentResponse as any[]).map((b: any) => b.text ?? "").join("\n") : "");
      const questions = this.extractQuestions(text);
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

  private doDrafting(snapshot: ResearchSnapshot, plan: ResearchPlan, agentResponse?: unknown): ResearchStateResult {
    const reportText = extractTextContent(agentResponse);
    this.logger?.event("drafting_extracted", { textLength: reportText.length, agentResponseType: typeof agentResponse, isArray: Array.isArray(agentResponse) });
    if (!reportText || reportText.length < 40) {
      // Agent didn't produce a proper report — re-inject drafting prompt
      const inject = createReportStyle(plan.reportStyle ?? "narrative").buildDraftingPrompt(plan, snapshot.allFindings);
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

  private doSaving(snapshot: ResearchSnapshot, agentResponse?: unknown): ResearchStateResult {
    let text = snapshot.draftReport ?? "";
    // Fallback: if draft was stripped by session persistence, try re-extracting
    // from the agent response passed directly (bypasses fragile assistant-message lookup)
    if (text.length < 40 && agentResponse !== undefined) {
      text = extractTextContent(agentResponse);
    }
    if (text.length < 40) {
      this.logger?.event("saving_blocked", { reason: "empty_draft", draftLength: text.length });
      return { phase: "saving", snapshot };
    }
    this.logger?.event("phase_changed", { from: "saving", to: "done", draftLength: text.length });
    return { phase: "done", snapshot: { ...snapshot, phase: "done", draftReport: text } };
  }
}

/** Extract plain text from agent response (handles string and content blocks array). */
export function extractTextContent(agentResponse?: unknown): string {
  if (!agentResponse) return "";
  if (typeof agentResponse === "string") return agentResponse;
  if (Array.isArray(agentResponse)) {
    return (agentResponse as any[])
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

/** Build a telemetry summary section to append to the final report. */
export function buildTelemetrySection(snapshot: ResearchSnapshot, extensionVersion?: string, artifactLinks?: string[], profileName?: string): string {
  const durationSec = Math.round((Date.now() - snapshot.startedAt) / 1000);
  const durationStr =
    durationSec < 60
      ? `${durationSec}s`
      : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;

  const prof = snapshot.profile;
  const rows = [
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Run ID | \`${snapshot.runId}\` |`,
  ];
  if (extensionVersion) {
    rows.push(`| Pi Extension version | \`${extensionVersion}\` |`);
  }
  if (profileName && prof) {
    rows.push(`| Profile | ${profileName} |`);
    rows.push(`| Breadth | ${prof.breadth} |`);
    rows.push(`| Depth | ${prof.depth} |`);
    rows.push(`| Concurrency | ${prof.concurrency} |`);
    if (prof.maxSearchCalls) rows.push(`| Max search calls | ${prof.maxSearchCalls} |`);
    if (prof.maxElapsedSeconds) rows.push(`| Max elapsed (s) | ${prof.maxElapsedSeconds} |`);
  }
  rows.push(
    `| Search calls | ${snapshot.searchCalls} |`,
    `| Scrape calls | ${snapshot.scrapeCalls} |`,
    `| Sources visited | ${snapshot.allVisitedUrls.length} |`,
    `| Depth reached | ${snapshot.currentDepth}/${snapshot.totalDepth} |`,
    `| Duration | ${durationStr} |`,
    `| Soft limit triggered | ${snapshot.softLimitTriggered ? "yes" : "no"} |`,
  );

  return [
    `## Research Telemetry`,
    ``,
    ...rows,
    ``,
    ...(artifactLinks && artifactLinks.length > 0
      ? [`## Artifacts`, ``, ...artifactLinks.map((p) => `- [${p}](${p})`), ``]
      : []),
    ``,
  ].join("\n");
}


const stateMachineDir = dirname(fileURLToPath(import.meta.url));
const defaultArtifactsDir = () => join(stateMachineDir, "..", "..", "deep-research", "artifacts");
const rootPkgPath = join(stateMachineDir, "..", "package.json");

/** Read extension version from root package.json. Returns undefined if unreadable. */
export function readExtensionVersion(pkgPath?: string): string | undefined {
  try {
    const path = pkgPath ?? rootPkgPath;
    if (!existsSync(path)) return undefined;
    const pkg = JSON.parse(readFileSync(path, "utf-8"));
    return pkg.version || undefined;
  } catch {
    return undefined;
  }
}
/** @deprecated Use createReportStyle instead. */
export function buildDraftingPrompt(plan: ResearchPlan, findings: Finding[]): string {
  return createReportStyle(plan.reportStyle ?? "narrative").buildDraftingPrompt(plan, findings);
}
