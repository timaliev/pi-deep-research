import type { ResearchSnapshot } from "./state-machine.js";

const STATE_KEY = "deep-research:state";
const REPORT_PATH_KEY = "deep-research:report-path";
const CONFIRMATION_KEY = "deep-research:plan-confirmed";

export interface EntryWriter {
  appendEntry(customType: string, data?: unknown): void;
}

export class SessionState {
  constructor(private readonly writer: EntryWriter) {}

  /** Persist research snapshot + extra metadata (plan, planArtifactPath, deepResearchBase). */
  saveState(snapshot: ResearchSnapshot, extra: Record<string, unknown>): void {
    const { draftReport: _dr, ...safe } = snapshot;
    this.writer.appendEntry(STATE_KEY, {
      ...safe,
      draftReady: (snapshot.draftReport?.length ?? 0) >= 40,
      draftLength: snapshot.draftReport?.length ?? 0,
      ...extra,
    });
  }

  /** Restore persisted state from session entries. Returns undefined if no state found. */
  static restoreState(entries: Array<{ customType?: string; data?: unknown }>): Record<string, unknown> | undefined {
    const entry = [...entries].reverse().find((e) => e.customType === STATE_KEY);
    return entry?.data as Record<string, unknown> | undefined;
  }

  saveReportPath(path: string, reportsDir: string, telemetry: string, runId?: string): void {
    this.writer.appendEntry(REPORT_PATH_KEY, { path, reportsDir, telemetry, runId });
  }

  saveConfirmation(planArtifactPath: string): void {
    this.writer.appendEntry(CONFIRMATION_KEY, { planArtifactPath });
  }
}
