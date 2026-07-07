import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { topicToSlug } from "./slug.js";
import { buildTelemetrySection, readExtensionVersion } from "./state-machine.js";
import type { ResearchSnapshot } from "./state-machine.js";

/** Compute canonical report path from topic and directory. */
export function resolveReportPath(
  topic: string,
  reportsDir: string,
  runId?: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = topicToSlug(topic);
  const filename = runId
    ? `${runId}-${slug}.md`
    : `${date}-${slug}.md`;
  return join(reportsDir, filename);
}

export interface ReportAssemblyParams {
  snapshot: ResearchSnapshot;
  topic: string;
  reportsDir: string;
  planArtifactPath: string;
  logsDir: string;
  extensionVersion?: string;
  profileName?: string;
}

/**
 * Assemble final report: markdown body + telemetry + artifact links, write to disk.
 * Returns the absolute report path.
 */
export function assembleReport(params: ReportAssemblyParams): string {
  const { snapshot, topic, reportsDir, planArtifactPath, logsDir, extensionVersion, profileName } = params;

  mkdirSync(reportsDir, { recursive: true });

  const reportPath = resolveReportPath(topic, reportsDir);

  const reportText = snapshot.draftReport ?? "";

  const ver = extensionVersion ?? readExtensionVersion();
  const telemetry = buildTelemetrySection(snapshot, ver, [
    planArtifactPath,
    join(logsDir, `${snapshot.runId}.log`),
  ], profileName);

  const fullReport = `${reportText}\n\n${telemetry}\n`;
  writeFileSync(reportPath, fullReport, "utf-8");

  return reportPath;
}
