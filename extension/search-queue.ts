import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DDG_MIN_DELAY_MS = 2000;

/** A single queued search request with scheduling metadata. */
export interface QueuedSearch {
  question: string;
  engine: string;
  scheduledDelayMs: number;
  timestamp: string;
  executedAt?: string;
  actualDelayMs?: number;
  success?: boolean;
}

/** Build a queue of search requests, round-robining engines across questions. */
export function buildSearchQueue(
  questions: string[],
  engines: string[],
): QueuedSearch[] {
  const now = new Date().toISOString();
  const queue: QueuedSearch[] = [];

  // Track per-engine cumulative delay
  const engineDelay: Record<string, number> = {};

  for (let i = 0; i < questions.length; i++) {
    const engine = engines[i % engines.length];
    const prevDelay = engineDelay[engine] ?? 0;

    // Free engines (DDG, SearXNG) need stagger delay; paid engines don't
    const needsStagger = engine === "duckduckgo" || engine === "searxng";
    const scheduledDelayMs = needsStagger ? prevDelay : 0;

    queue.push({
      question: questions[i],
      engine,
      scheduledDelayMs,
      timestamp: now,
    });

    // Accumulate delay for next request on this engine
    if (needsStagger) {
      engineDelay[engine] = (engineDelay[engine] ?? 0) + DDG_MIN_DELAY_MS;
    }
  }

  return queue;
}

/** Save queue as JSON file, creating parent directories. */
export function saveQueue(queue: QueuedSearch[], path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(queue, null, 2), "utf-8");
}
