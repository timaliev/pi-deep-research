import { join } from "node:path";
import type { ConcurrencySemaphore } from "./concurrency.js";
import type { Logger } from "./logger.js";
import type { ScrapedPage, Scraper } from "./scraper.js";
import type { SearchEngine, searchWeb as SearchWebFn, WebSearchResult } from "./search/web-search.js";
import { buildSearchQueue, saveQueue } from "./search-queue.js";

export interface ResearchRoundParams {
  searchFn: typeof SearchWebFn;
  scraper: Scraper;
  logger?: Logger;
  activeQuestions: string[];
  maxResultsPerQuery: number;
  engines: SearchEngine[];
  semaphore: ConcurrencySemaphore;
  visitedUrls: Set<string>;
  artifactsDir?: string;
  runId: string;
  currentDepth: number;
  searchCred?: Record<string, unknown>;
}

export interface ResearchRoundResult {
  searchResults: Array<{ question: string; results: WebSearchResult[] }>;
  scrapedPages: ScrapedPage[];
  newVisitedUrls: Set<string>;
  searchCalls: number;
  scrapeCalls: number;
}

export async function executeResearchRound(params: ResearchRoundParams): Promise<ResearchRoundResult> {
  const {
    searchFn,
    scraper,
    logger,
    activeQuestions,
    maxResultsPerQuery,
    engines,
    semaphore,
    visitedUrls,
    artifactsDir,
    runId,
    currentDepth,
    searchCred,
  } = params;

  if (activeQuestions.length === 0 || engines.length === 0) {
    return { searchResults: [], scrapedPages: [], newVisitedUrls: visitedUrls, searchCalls: 0, scrapeCalls: 0 };
  }

  let searchCalls = 0;
  let scrapeCalls = 0;

  // Build and save search request queue for post-mortem analysis
  const queue = buildSearchQueue(activeQuestions, engines);
  if (artifactsDir) {
    try {
      saveQueue(queue, join(artifactsDir, `queue-${runId}-d${currentDepth}.json`));
      logger?.event("queue_saved", {
        depth: currentDepth,
        entries: queue.length,
        engines: engines.join(","),
      });
    } catch {
      /* non-critical */
    }
  }

  // Concurrent searches
  const searchResults = await Promise.all(
    activeQuestions.map((question) =>
      semaphore.run(async () => {
        const startMs = Date.now();
        const results = await searchFn(question, maxResultsPerQuery, engines, { logger, credentials: searchCred });
        logger?.event("search_executed", {
          query: question,
          resultCount: results.length,
          elapsedMs: Date.now() - startMs,
          depth: currentDepth,
        });
        searchCalls++;
        return { question, results };
      }),
    ),
  );

  // Collect URLs for scraping
  const newVisited = new Set(visitedUrls);
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
          const page = await scraper.scrape(url);
          logger?.event("scrape_executed", {
            url,
            title: page.title,
            bytes: page.content.length,
            elapsedMs: Date.now() - startMs,
            depth: currentDepth,
          });
          scrapeCalls++;
          return page;
        } catch (err: unknown) {
          logger?.event("scrape_failed", { url, error: err instanceof Error ? err.message : String(err), depth: currentDepth });
          return null;
        }
      }),
    ),
  );

  const scrapedPages: ScrapedPage[] = scrapedResults.filter((p): p is ScrapedPage => p !== null);

  return { searchResults, scrapedPages, newVisitedUrls: newVisited, searchCalls, scrapeCalls };
}
