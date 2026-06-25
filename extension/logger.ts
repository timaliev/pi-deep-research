import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Logger {
  /** Emit a timestamped JSONL event. Auto-flushes to disk. */
  event(type: string, data: Record<string, unknown>): void;
}

/**
 * JSONL logger that appends one JSON line per event to a file.
 * Auto-flushes on every event call — crash-safe.
 */
export class JsonlLogger implements Logger {
  private readonly path: string;
  private readonly runId: string;

  constructor(runId: string, path: string) {
    this.runId = runId;
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  event(type: string, data: Record<string, unknown>): void {
    const entry = {
      ts: new Date().toISOString(),
      runId: this.runId,
      type,
      ...data,
    };
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.path, line, "utf-8");
  }
}
