/**
 * Shared types for prefilter artifacts.
 * Extracted from prefilter.ts to separate types from implementation (ADR-0028 deepening).
 */

import type { Logger } from "./logger.js";
import type { ProfileResolver } from "./profile-resolver.js";
import type { ScrapedPage, Scraper } from "./scraper.js";
import type { SearchEngine, searchWeb as SearchWebFn, WebSearchResult } from "./search/web-search.js";
import type { SearchProviderCredentials } from "./settings-context.js";

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
  engines: SearchEngine[];
  profile: ResearchPlanProfile;
  reportStyle?: "narrative" | "subtopics";
  enabledEngines?: string[];
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
  createdAt: string;
  inputTopic: string;
  plan: ResearchPlan;
  preliminarySearch: {
    query: string;
    resultsCount?: number;
    scrapedUrls?: string[];
    note?: string;
  };
}

export type PrefilterInput =
  | { type: "topic"; topic: string }
  | { type: "params"; engines: SearchEngine[]; profile: ResearchPlanProfile }
  | { type: "continue"; llmResponse?: string }
  | { type: "plan"; planJson: string; topic?: string };

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
