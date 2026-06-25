import { generateRunId } from "./ids.js";
import type { searchWeb as SearchWebFn } from "./search/web-search.js";
import type { WebSearchResult } from "./search/web-search.js";
import type { SearchEngine } from "./search/web-search.js";
import type { Scraper, ScrapedPage } from "./scraper.js";

export interface ResearchPlan {
  topic: string;
  goal: string;
  researchQuestions: string[];
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
  phase: "awaiting_plan" | "plan_ready" | "error";
  runId: string;
  planArtifactPath?: string;
  searchResults?: WebSearchResult[];
  scrapedContent?: ScrapedPage[];
  plan?: ResearchPlan;
  inject?: string; // prompt to send to agent
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
  private readonly searchEngines: SearchEngine[];
  private readonly scraper: Scraper;
  private readonly artifactsDir: string;

  constructor(
    searchFn: typeof SearchWebFn,
    scraper: Scraper,
    artifactsDir: string,
    searchEngines: SearchEngine[] = ["duckduckgo"],
  ) {
    this.searchFn = searchFn;
    this.searchEngines = searchEngines;
    this.scraper = scraper;
    this.artifactsDir = artifactsDir;
  }

  /**
   * First call: perform preliminary search and scrape.
   * Returns results + an inject prompt asking the agent to produce a JSON plan.
   */
  async start(topic: string): Promise<PrefilterResult> {
    const runId = generateRunId();

    // Preliminary search
    const searchQuery = this.buildSearchQuery(topic);
    const searchResults = await this.searchFn(searchQuery, 3, this.searchEngines);

    // Scrape top results (up to 2)
    const scrapedContent: ScrapedPage[] = [];
    for (const result of searchResults.slice(0, 2)) {
      try {
        const page = await this.scraper.scrape(result.url);
        scrapedContent.push(page);
      } catch {
        // Skip pages that fail to scrape
      }
    }

    // Build inject prompt with search context
    const inject = this.buildInjectPrompt(topic, searchResults, scrapedContent);

    return {
      phase: "awaiting_plan",
      runId,
      inject,
      searchResults,
      scrapedContent,
    };
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
      return {
        phase: "error",
        runId,
        error: "Failed to parse plan JSON. Ensure valid JSON syntax.",
      };
    }

    // Validate required fields
    const validationError = this.validatePlan(plan);
    if (validationError) {
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

  private buildInjectPrompt(
    topic: string,
    searchResults: WebSearchResult[],
    scrapedContent: ScrapedPage[]
  ): string {
    let prompt = `## Research Planning

You are planning a deep research investigation on this topic:

**Topic:** ${topic}

### Preliminary Search Results

`;

    for (const result of searchResults) {
      prompt += `- [${result.title}](${result.url}): ${result.snippet}\n`;
    }

    if (scrapedContent.length > 0) {
      prompt += `\n### Scraped Content from Top Results\n\n`;
      for (const page of scrapedContent) {
        const excerpt =
          page.content.length > 800
            ? page.content.substring(0, 800) + "..."
            : page.content;
        prompt += `**Source: ${page.title}** (${page.url})\n\n${excerpt}\n\n---\n`;
      }
    }

    prompt += `
### Instructions

Based on the topic and preliminary search results above, produce a structured research plan as **valid JSON** with this exact shape:

\`\`\`json
{
  "topic": "The research topic",
  "goal": "What this research aims to achieve",
  "researchQuestions": [
    "Specific question 1",
    "Specific question 2",
    "Specific question 3"
  ],
  "scope": {
    "include": "What to include",
    "exclude": "What to exclude"
  },
  "estimatedCost": {
    "searchCalls": 12,
    "scrapeCalls": 8,
    "description": "~12 searches, ~8 page scrapes"
  }
}
\`\`\`

Rules:
- Provide 3-5 research questions.
- Be specific in scope.include and scope.exclude.
- Keep estimatedCost realistic (each research question costs ~3 searches + ~2 scrapes).
- Output ONLY the JSON, no other text.
`;

    return prompt;
  }

  private validatePlan(plan: unknown): string | null {
    if (!plan || typeof plan !== "object") {
      return "Plan must be a JSON object";
    }

    const p = plan as Record<string, unknown>;

    if (!p.topic || typeof p.topic !== "string" || !p.topic.trim()) {
      return "Plan must include a non-empty 'topic' string";
    }
    if (!p.goal || typeof p.goal !== "string" || !p.goal.trim()) {
      return "Plan must include a non-empty 'goal' string";
    }
    if (!Array.isArray(p.researchQuestions) || p.researchQuestions.length === 0) {
      return "Plan must include at least one research question in 'researchQuestions' array";
    }
    for (const q of p.researchQuestions) {
      if (typeof q !== "string" || !q.trim()) {
        return "All research questions must be non-empty strings";
      }
    }
    if (!p.scope || typeof p.scope !== "object") {
      return "Plan must include a 'scope' object with include/exclude";
    }
    if (!p.estimatedCost || typeof p.estimatedCost !== "object") {
      return "Plan must include 'estimatedCost' object";
    }

    return null; // valid
  }
}
