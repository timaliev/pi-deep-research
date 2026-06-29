import type { ResearchPlan, ResearchPlanProfile } from "./prefilter.js";
import { generateRunId } from "./ids.js";
import type { Logger } from "./logger.js";
import type { searchWeb as SearchWebFn } from "./search/web-search.js";
import type { WebSearchResult } from "./search/web-search.js";
import type { SearchEngine } from "./search/web-search.js";
import type { Scraper, ScrapedPage } from "./scraper.js";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

/** Hardcoded presets, overridable via settings. */
export const DEFAULT_PRESETS: Record<string, ResearchProfile> = {
  default: { breadth: 4, depth: 2, concurrency: 4 },
  fast:    { breadth: 2, depth: 1, concurrency: 2 },
  deep:    { breadth: 6, depth: 3, concurrency: 4 },
};

/** Resolve a ResearchPlanProfile into a concrete ResearchProfile. */
export function resolveProfile(
  planProfile: ResearchPlanProfile,
  presets?: Record<string, ResearchProfile>,
): ResearchProfile {
  const p = presets ?? DEFAULT_PRESETS;
  if (planProfile.name !== "custom") {
    return p[planProfile.name] ?? p.default;
  }
  const preset = p.custom;
  return {
    breadth: planProfile.breadth ?? preset?.breadth ?? 4,
    depth: planProfile.depth ?? preset?.depth ?? 2,
    concurrency: planProfile.concurrency ?? preset?.concurrency ?? 4,
    maxSearchCalls: preset?.maxSearchCalls,
    maxElapsedSeconds: preset?.maxElapsedSeconds,
  };
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
export class ResearchStateMachine {
  constructor(
    private readonly searchFn: typeof SearchWebFn,
    private readonly scraper: Scraper,
    private readonly profilePresets?: Record<string, ResearchProfile>,
    private readonly logger?: Logger,
  ) {}

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
    if (!snapshot.profile) {
      snapshot.profile = resolveProfile(plan.profile, this.profilePresets);
      snapshot.totalDepth = snapshot.profile.depth;
    }
    switch (snapshot.phase) {
      case "searching":  return this.doSearching(snapshot, plan);
      case "extracting": return this.doExtracting(snapshot, plan);
      case "questioning": return this.doQuestioning(snapshot, plan, agentResponse);
      case "drafting":   return this.doDrafting(snapshot, plan, agentResponse);
      case "saving":     return this.doSaving(snapshot);
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

    // Concurrent searches
    const searchResults = await Promise.all(
      activeQuestions.map((question) =>
        semaphore.run(async () => {
          const startMs = Date.now();
          const results = await this.searchFn(question, maxResultsPerQuery, engines, { logger: this.logger });
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

    const inject = buildExtractionPrompt(searchResults, scraped, nextDepth, snapshot.totalDepth);
    this.logger?.event("phase_changed", { from: "searching", to: "extracting", depth: nextDepth });
    this.logger?.event("inject_sent", { type: "extraction", length: inject.length, depth: nextDepth });
    return { phase: "extracting", snapshot: nextSnapshot, inject };
  }

  private doExtracting(snapshot: ResearchSnapshot, plan: ResearchPlan): ResearchStateResult {
    // Soft limit: stop deepening, go straight to drafting
    const shouldDeepen = !snapshot.softLimitTriggered && snapshot.currentDepth < snapshot.totalDepth;
    if (shouldDeepen) {
      const inject = buildQuestioningPrompt(plan, snapshot.currentDepth, snapshot.totalDepth);
      this.logger?.event("phase_changed", { from: "extracting", to: "questioning", depth: snapshot.currentDepth });
      this.logger?.event("inject_sent", { type: "deepening", length: inject.length, depth: snapshot.currentDepth });
      return { phase: "questioning", snapshot: { ...snapshot, phase: "questioning" }, inject };
    }
    this.logger?.event("deepening_skipped", {
      reason: snapshot.softLimitTriggered ? "soft_limit" : "depth_reached",
      currentDepth: snapshot.currentDepth,
      totalDepth: snapshot.totalDepth,
    });
    const inject = buildDraftingPrompt(plan, snapshot.allFindings);
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
      const inject = buildDraftingPrompt(plan, snapshot.allFindings);
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

  private doSaving(snapshot: ResearchSnapshot): ResearchStateResult {
    if (!snapshot.draftReport || snapshot.draftReport.length < 40) {
      this.logger?.event("saving_blocked", { reason: "empty_draft", draftLength: snapshot.draftReport?.length ?? 0 });
      return { phase: "saving", snapshot };
    }
    this.logger?.event("phase_changed", { from: "saving", to: "done", draftLength: snapshot.draftReport.length });
    return { phase: "done", snapshot: { ...snapshot, phase: "done" } };
  }
}

/** Extract plain text from agent response (handles string and content blocks array). */
function extractTextContent(agentResponse?: unknown): string {
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
export function buildTelemetrySection(snapshot: ResearchSnapshot, extensionVersion?: string): string {
  const durationSec = Math.round((Date.now() - snapshot.startedAt) / 1000);
  const durationStr =
    durationSec < 60
      ? `${durationSec}s`
      : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;

  const rows = [
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Run ID | \`${snapshot.runId}\` |`,
  ];
  if (extensionVersion) {
    rows.push(`| Version | \`${extensionVersion}\` |`);
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
  ].join("\n");
}

function buildExtractionPrompt(
  allResults: Array<{ question: string; results: WebSearchResult[] }>,
  scraped: ScrapedPage[],
  depth: number,
  totalDepth: number
): string {
  let prompt = `## Research Extraction — Depth ${depth}/${totalDepth}\n\n`;
  prompt += `Extract key findings from the following search results. For each finding, include:\n`;
  prompt += `- The insight (1-2 sentences)\n`;
  prompt += `- Source URL\n`;
  prompt += `- A relevant quote/citation from the source\n\n`;
  prompt += `### Search Results\n\n`;
  for (const { question, results } of allResults) {
    prompt += `**Query:** ${question}\n`;
    for (const r of results) prompt += `- [${r.title}](${r.url}): ${r.snippet}\n`;
    prompt += `\n`;
  }
  if (scraped.length > 0) {
    prompt += `### Scraped Content\n\n`;
    for (const page of scraped) {
      const excerpt = page.content.length > 1000 ? page.content.substring(0, 1000) + "..." : page.content;
      prompt += `**Source: ${page.title}** (${page.url})\n\n${excerpt}\n\n---\n`;
    }
  }
  prompt += `\nProduce findings as a numbered list. Each finding must cite its source URL in parentheses.`;
  return prompt;
}

function buildQuestioningPrompt(plan: ResearchPlan, currentDepth: number, totalDepth: number): string {
  return `## Research Deepening — Depth ${currentDepth}/${totalDepth}

Based on the findings so far, generate 2-3 follow-up questions to deepen the research.
These questions should explore aspects not yet fully covered.

**Original research goal:** ${plan.goal}

Produce questions as a numbered list. Each question should be specific and researchable via web search.
`;
}

export function buildDraftingPrompt(plan: ResearchPlan, findings: Finding[]): string {
  const style = plan.reportStyle ?? "narrative";
  if (style === "subtopics") {
    return buildSubtopicsPrompt(plan, findings);
  }
  return buildNarrativePrompt(plan, findings);
}

function buildNarrativePrompt(plan: ResearchPlan, findings: Finding[]): string {
  let prompt = `## Final Report

Write a structured markdown research report based on the following plan and findings. Write the report as your response text directly — do NOT call any tools. Call run_research only after you have written the complete report.

**Topic:** ${plan.topic}
**Goal:** ${plan.goal}

### Structure

1. **Introduction** — background and why this matters
2. **Findings** — organized by theme, with citations
3. **Analysis** — what the findings mean, patterns, contradictions
4. **Recommendations** — actionable insights
5. **Sources** — list of all cited URLs

### Key Findings

`;
  for (const f of findings) prompt += `- ${f.text} [Source: ${f.sourceUrl}]\n`;
  return prompt;
}

function buildSubtopicsPrompt(plan: ResearchPlan, findings: Finding[]): string {
  let prompt = `## Final Report (Subtopics)

Write a comprehensive markdown research report. Discover ${plan.researchQuestions.length >= 5 ? "8–10" : "5–7"} thematic sections based on the findings below — each section a dedicated topic with subsections where appropriate.

Do NOT use a rigid 5-section template. Instead, let the content drive the structure: group findings into natural themes, give each its own numbered section with descriptive headings, and include data tables, quotes, and comparisons where the evidence supports them.

Write the report as your response text directly — do NOT call any tools. Call run_research only after you have written the complete report.

**Topic:** ${plan.topic}
**Goal:** ${plan.goal}

### Structure Guidance

- Start with an Executive Summary (unnumbered)
- Numbered sections (1., 2., 3., …) — each a distinct thematic area discovered from the findings
- Subsections (1.1, 1.2, …) where a theme has multiple facets
- End with a Recommendations section and a References section

### Key Findings

`;
  for (const f of findings) prompt += `- ${f.text} [Source: ${f.sourceUrl}]\n`;
  return prompt;
}

const stateMachineDir = dirname(fileURLToPath(import.meta.url));
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