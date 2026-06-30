import type { ResearchSnapshot } from "./state-machine.js";
import { extractTextContent } from "./state-machine.js";

const STATE_KEY = "deep-research:state";
const REPORT_PATH_KEY = "deep-research:report-path";
const CONFIRMATION_KEY = "deep-research:plan-confirmed";
const DRAFT_KEY = "deep-research:draft";

export interface EntryWriter {
  appendEntry(customType: string, data?: unknown): void;
}

export class SessionState {
  constructor(private readonly writer: EntryWriter) {}

  saveResearchState(snapshot: ResearchSnapshot, extra: Record<string, unknown>): void {
    const { draftReport: _dr, ...safe } = snapshot;
    this.writer.appendEntry(STATE_KEY, {
      ...safe,
      draftReady: (snapshot.draftReport?.length ?? 0) >= 40,
      draftLength: snapshot.draftReport?.length ?? 0,
      ...extra,
    });
  }

  /** Store draft text in a dedicated session entry, keyed by runId.
   *  Separates large draft payload from the lightweight state entry
   *  so doSaving can recover it without fragile assistant-message extraction. */
  saveDraft(runId: string, draftText: string): void {
    this.writer.appendEntry(DRAFT_KEY, { runId, draftText });
  }

  saveReportPath(path: string, reportsDir: string, telemetry: string, runId?: string): void {
    this.writer.appendEntry(REPORT_PATH_KEY, { path, reportsDir, telemetry, runId });
  }

  saveConfirmation(planArtifactPath: string): void {
    this.writer.appendEntry(CONFIRMATION_KEY, { planArtifactPath });
  }

  /** Recover draft text. Priority: (1) dedicated draft entry keyed by runId,
   *  (2) extraction from the last assistant agent response.
   *  Accepts session entries for direct draft lookup — bypasses fragile
   *  assistant-message format assumptions. */
  restoreDraft(stateData: Record<string, unknown>, agentResponse?: string, entries?: Array<{ customType?: string; data?: unknown }>): string {
    if (!stateData.draftReady) return "";
    // Try dedicated draft entry first (most reliable path)
    if (entries) {
      const runId = stateData.runId as string;
      const draftEntry = [...entries].reverse().find(
        (e) => e.customType === DRAFT_KEY && (e.data as Record<string, unknown>)?.runId === runId
      );
      const draftText = (draftEntry?.data as Record<string, unknown>)?.draftText as string | undefined;
      if (draftText && draftText.length >= 40) return draftText;
    }
    // Fall back to assistant-message extraction
    const text = extractTextContent(agentResponse);
    return text && text.length >= 40 ? text : "";
  }
}
