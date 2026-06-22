import type { ResearchPlan } from "./prefilter.js";
import type { SearchProvider, SearchResult } from "./search/provider.js";
import type { Scraper, ScrapedPage } from "./scraper.js";

/** Parameters controlling research depth and breadth. */
export interface ResearchProfile {
  breadth: number;
  depth: number;
  concurrency: number;
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
}

export interface ResearchStateResult {
  phase: "searching" | "extracting" | "questioning" | "drafting" | "saving" | "done";
  snapshot: ResearchSnapshot;
  inject?: string;
  reportPath?: string;
  error?: string;
}

/**
 * Research state machine — advances through research phases.
 * Pure-ish: takes current snapshot + plan, performs search/scrape,
 * returns next phase. Caller handles persistence and LLM interaction.
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

  private async doSearching(
    snapshot: ResearchSnapshot,
    plan: ResearchPlan
  ): Promise<ResearchStateResult> {
    const questions =
      snapshot.allFindings.length === 0
        ? plan.researchQuestions
        : snapshot.allFindings.slice(-3).map((f) => f.text);

    const allResults: Array<{ question: string; results: SearchResult[] }> = [];
    const scraped: ScrapedPage[] = [];
    const newVisited = new Set(snapshot.allVisitedUrls);

    for (const question of questions.slice(0, this.profile.breadth)) {
      const results = await this.searchProvider.search(question, 3);
      snapshot.searchCalls++;
      allResults.push({ question, results });

      for (const result of results.slice(0, 2)) {
        if (newVisited.has(result.url)) continue;
        try {
          const page = await this.scraper.scrape(result.url);
          scraped.push(page);
          newVisited.add(result.url);
          snapshot.scrapeCalls++;
        } catch {
          // skip pages that fail to scrape
        }
      }
    }

    const nextDepth = snapshot.currentDepth + 1;
    const nextSnapshot: ResearchSnapshot = {
      ...snapshot,
      phase: "extracting",
      currentDepth: nextDepth,
      allVisitedUrls: [...newVisited],
    };

    const inject = buildExtractionPrompt(allResults, scraped, nextDepth, snapshot.totalDepth);
    return { phase: "extracting", snapshot: nextSnapshot, inject };
  }

  private doExtracting(snapshot: ResearchSnapshot, plan: ResearchPlan): ResearchStateResult {
    const shouldDeepen = snapshot.currentDepth < snapshot.totalDepth;
    if (shouldDeepen) {
      const inject = buildQuestioningPrompt(plan, snapshot.currentDepth, snapshot.totalDepth);
      return { phase: "questioning", snapshot: { ...snapshot, phase: "questioning" }, inject };
    }
    const inject = buildDraftingPrompt(plan, snapshot.allFindings);
    return { phase: "drafting", snapshot: { ...snapshot, phase: "drafting" }, inject };
  }

  private async doQuestioning(snapshot: ResearchSnapshot, plan: ResearchPlan): Promise<ResearchStateResult> {
    // Agent has already answered the questioning prompt.
    // Chain directly into searching.
    const searchSnapshot: ResearchSnapshot = { ...snapshot, phase: "searching" };
    return this.doSearching(searchSnapshot, plan);
  }

  private doDrafting(snapshot: ResearchSnapshot, _plan: ResearchPlan): ResearchStateResult {
    // Drafting inject was already sent by doExtracting.
    // Agent has written the draft; now save it.
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
