import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { SettingsContext } from "./settings-context.js";
import { appendSettingsSection } from "./settings-reporter.js";
import { topicToSlug } from "./slug.js";
import type { ResearchSnapshot } from "./state-machine.js";

/** Compute canonical report path from topic and directory. */
export function resolveReportPath(topic: string, reportsDir: string, runId?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = topicToSlug(topic);
  const filename = runId ? `${runId}-${slug}.md` : `${date}-${slug}.md`;
  return join(reportsDir, filename);
}

/** Write report markdown to file. Appends telemetry section if not already present. */
export function writeReportFile(path: string, content: string, telemetry?: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const final = telemetry && !content.includes("## Research Telemetry") ? `${content}\n\n${telemetry}\n` : content;
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
  reportStyle?: string;
  /** Append ## Settings section to report (ADR-0023). Requires settings for provenance. */
  appendSettingsReport?: boolean;
  settings?: SettingsContext;
}

/**
 * Assemble final report: markdown body + telemetry + artifact links + optional settings, write to disk.
 * Returns the absolute report path.
 */
export function assembleReport(params: ReportAssemblyParams): string {
  const { snapshot, topic, reportsDir, planArtifactPath, logsDir, extensionVersion, profileName } = params;

  const reportPath = resolveReportPath(topic, reportsDir);

  let reportText = snapshot.draft.get();

  // ADR-0023: append settings section if requested (must happen before PDF export)
  if (params.appendSettingsReport && params.settings) {
    reportText = appendSettingsSection(reportText, params.settings);
  }

  const meta = extensionVersion ? { version: extensionVersion } : readExtensionMeta();
  const artifactLinks = [
    relative(dirname(reportPath), planArtifactPath),
    relative(dirname(reportPath), join(logsDir, `${snapshot.runId}.log`)),
  ];
  const telemetry = buildTelemetrySection(snapshot, meta.version, artifactLinks, profileName, undefined, meta.repoUrl);

  writeReportFile(reportPath, reportText, telemetry);

  return reportPath;
}

/** Build a telemetry summary section to append to the final report. */
export function buildTelemetrySection(
  snapshot: ResearchSnapshot,
  extensionVersion?: string,
  artifactLinks?: string[],
  profileName?: string,
  reportStyle?: string,
  extensionRepoUrl?: string,
): string {
  const durationSec = Math.round((Date.now() - snapshot.startedAt) / 1000);
  const durationStr = durationSec < 60 ? `${durationSec}s` : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;

  const prof = snapshot.profile;
  const rows = [`| Metric | Value |`, `| --- | --- |`, `| Run ID | \`${snapshot.runId}\` |`];
  if (extensionVersion) {
    rows.push(`| Pi Extension version | \`${extensionVersion}\` |`);
  }
  if (extensionRepoUrl) {
    rows.push(`| Pi Extension repository | [${extensionRepoUrl}](${extensionRepoUrl}) |`);
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

/** Read extension version and repository URL from root package.json. Returns undefined fields if unreadable. */
export function readExtensionMeta(pkgPath?: string): { version?: string; repoUrl?: string } {
  try {
    const path = pkgPath ?? rootPkgPath;
    if (!existsSync(path)) return {};
    const pkg = JSON.parse(readFileSync(path, "utf-8"));
    return {
      version: pkg.version || undefined,
      repoUrl: pkg.repository?.url || undefined,
    };
  } catch {
    return {};
  }
}
