import type { ResearchSnapshot } from "./state-machine.js";
import { extractTextContent } from "./state-machine.js";

const STATE_KEY = "deep-research:state";
const REPORT_PATH_KEY = "deep-research:report-path";
const CONFIRMATION_KEY = "deep-research:plan-confirmed";

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

  saveReportPath(path: string, reportsDir: string, telemetry: string): void {
    this.writer.appendEntry(REPORT_PATH_KEY, { path, reportsDir, telemetry });
  }

  saveConfirmation(planArtifactPath: string): void {
    this.writer.appendEntry(CONFIRMATION_KEY, { planArtifactPath });
  }

  restoreDraft(stateData: Record<string, unknown>, agentResponse?: string): string {
    if (!stateData.draftReady) return "";
    const text = extractTextContent(agentResponse);
    return text && text.length >= 40 ? text : "";
  }
}
