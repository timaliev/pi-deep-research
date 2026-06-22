import type { ResearchPlan } from "./prefilter.js";
import type { SearchProvider, SearchResult } from "./search/provider.js";
import type { Scraper, ScrapedPage } from "./scraper.js";

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
  /** Soft limit has been triggered. When true, depth recursion stops and search intensity reduces. */
  softLimitTriggered: boolean;
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
    private readonly searchProvider: SearchProvider,
    private readonly scraper: Scraper,
    private readonly profile: ResearchProfile
  ) {}

  static init(plan: ResearchPlan, profile: ResearchProfile): ResearchSnapshot {
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
    };
  }

  async next(snapshot: ResearchSnapshot, plan: ResearchPlan): Promise<ResearchStateResult> {
    switch (snapshot.phase) {
      case "searching":  return this.doSearching(snapshot, plan);
      case "extracting": return this.doExtracting(snapshot, plan);
      case "questioning": return this.doQuestioning(snapshot, plan);
      case "drafting":   return this.doDrafting(snapshot, plan);
      case "saving":     return this.doSaving(snapshot);
      case "done":       return { phase: "done", snapshot };
    }
  }

  private checkSoftLimits(snapshot: ResearchSnapshot): void {
    const elapsed = (Date.now() - snapshot.startedAt) / 1000;
    const maxCalls = this.profile.maxSearchCalls ?? 0;
    const maxSec = this.profile.maxElapsedSeconds ?? 0;
    if (
      !snapshot.softLimitTriggered &&
      ((maxCalls > 0 && snapshot.searchCalls >= maxCalls) ||
       (maxSec > 0 && elapsed >= maxSec))
    ) {
      snapshot.softLimitTriggered = true;
    }
  }

  private async doSearching(
    snapshot: ResearchSnapshot,
    plan: ResearchPlan
  ): Promise<ResearchStateResult> {
    const questions =
      snapshot.allFindings.length === 0
        ? plan.researchQuestions
        : snapshot.allFindings.slice(-3).map((f) => f.text);

    // When soft-limited: fewer queries, fewer results per query
    const maxResultsPerQuery = snapshot.softLimitTriggered ? 2 : 3;
    const breadth = snapshot.softLimitTriggered
      ? Math.min(2, this.profile.breadth)
      : this.profile.breadth;

    const activeQuestions = questions.slice(0, breadth);
    const semaphore = new ConcurrencySemaphore(this.profile.concurrency);
    const newVisited = new Set(snapshot.allVisitedUrls);

    // Concurrent searches
    const searchResults = await Promise.all(
      activeQuestions.map((question) =>
        semaphore.run(async () => {
          const results = await this.searchProvider.search(question, maxResultsPerQuery);
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
            const page = await this.scraper.scrape(url);
            snapshot.scrapeCalls++;
            return page;
          } catch {
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
    return { phase: "extracting", snapshot: nextSnapshot, inject };
  }

  private doExtracting(snapshot: ResearchSnapshot, plan: ResearchPlan): ResearchStateResult {
    // Soft limit: stop deepening, go straight to drafting
    const shouldDeepen = !snapshot.softLimitTriggered && snapshot.currentDepth < snapshot.totalDepth;
    if (shouldDeepen) {
      const inject = buildQuestioningPrompt(plan, snapshot.currentDepth, snapshot.totalDepth);
      return { phase: "questioning", snapshot: { ...snapshot, phase: "questioning" }, inject };
    }
    const inject = buildDraftingPrompt(plan, snapshot.allFindings);
    return { phase: "drafting", snapshot: { ...snapshot, phase: "drafting" }, inject };
  }

  private async doQuestioning(snapshot: ResearchSnapshot, plan: ResearchPlan): Promise<ResearchStateResult> {
    const searchSnapshot: ResearchSnapshot = { ...snapshot, phase: "searching" };
    return this.doSearching(searchSnapshot, plan);
  }

  private doDrafting(snapshot: ResearchSnapshot, _plan: ResearchPlan): ResearchStateResult {
    return { phase: "saving", snapshot: { ...snapshot, phase: "saving" } };
  }

  private doSaving(snapshot: ResearchSnapshot): ResearchStateResult {
    return { phase: "done", snapshot: { ...snapshot, phase: "done" } };
  }
}

function generateRunId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}-${h}${mi}${s}`;
}

function buildExtractionPrompt(
  allResults: Array<{ question: string; results: SearchResult[] }>,
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

function buildDraftingPrompt(plan: ResearchPlan, findings: Finding[]): string {
  let prompt = `## Final Report

Write a structured markdown research report based on the following plan and findings.

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
