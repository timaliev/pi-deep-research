import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { topicToSlug } from "./slug.js";
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

/** Write report markdown to file. Appends telemetry section if not already present. */
export function writeReportFile(
  path: string,
  content: string,
  telemetry?: string,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const final = (telemetry && !content.includes("## Research Telemetry"))
    ? `${content}\n\n${telemetry}\n`
    : content;
  writeFileSync(path, final, "utf-8");
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

  const reportPath = resolveReportPath(topic, reportsDir);

  const reportText = snapshot.draftReport ?? "";

  const ver = extensionVersion ?? readExtensionVersion();
  const telemetry = buildTelemetrySection(snapshot, ver, [
    planArtifactPath,
    join(logsDir, `${snapshot.runId}.log`),
  ], profileName);

  writeReportFile(reportPath, reportText, telemetry);

  return reportPath;
}

/** Build a telemetry summary section to append to the final report. */
export function buildTelemetrySection(snapshot: ResearchSnapshot, extensionVersion?: string, artifactLinks?: string[], profileName?: string, reportStyle?: string): string {
  const durationSec = Math.round((Date.now() - snapshot.startedAt) / 1000);
  const durationStr =
    durationSec < 60
      ? `${durationSec}s`
      : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;

  const prof = snapshot.profile;
  const rows = [
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Run ID | \`${snapshot.runId}\` |`,
  ];
  if (extensionVersion) {
    rows.push(`| Pi Extension version | \`${extensionVersion}\` |`);
  }
  if (profileName && prof) {
    rows.push(`| Profile | ${profileName} |`);
    rows.push(`| Breadth | ${prof.breadth} |`);
    rows.push(`| Depth | ${prof.depth} |`);
    rows.push(`| Concurrency | ${prof.concurrency} |`);
    if (prof.maxSearchCalls) rows.push(`| Max search calls | ${prof.maxSearchCalls} |`);
    if (prof.maxElapsedSeconds) rows.push(`| Max elapsed (s) | ${prof.maxElapsedSeconds} |`);
  }
  if (reportStyle) {
    rows.push(`| Report style | ${reportStyle} |`);
  }
  rows.push(
    `| Search calls | ${snapshot.searchCalls} |`,
    `| Scrape calls | ${snapshot.scrapeCalls} |`,
    `| Sources visited | ${snapshot.allVisitedUrls.length} |`,
    `| Depth reached | ${snapshot.currentDepth}/${snapshot.totalDepth} |`,
    `| Duration | ${durationStr} |`,
    `| Soft limit triggered | ${snapshot.softLimitTriggered ? "yes" : "no"} |`,
  );

  return [
    `## Research Telemetry`,
    ``,
    ...rows,
    ``,
    ...(artifactLinks && artifactLinks.length > 0
      ? [`## Artifacts`, ``, ...artifactLinks.map((p) => `- [${p}](${p})`), ``]
      : []),
    ``,
  ].join("\n");
}

const reportAssemblyDir = dirname(fileURLToPath(import.meta.url));
const rootPkgPath = join(reportAssemblyDir, "..", "package.json");

/** Read extension version from root package.json. Returns undefined if unreadable. */
export function readExtensionVersion(pkgPath?: string): string | undefined {
  try {
    const path = pkgPath ?? rootPkgPath;
    if (!existsSync(path)) return undefined;
    const pkg = JSON.parse(readFileSync(path, "utf-8"));
    return pkg.version || undefined;
  } catch {
    return undefined;
  }
}
