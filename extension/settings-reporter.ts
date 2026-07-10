import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SettingsContext } from "./settings-context.js";

/** Build markdown table of all settings with provenance. */
export function buildSettingsTable(ctx: SettingsContext): string {
  const entries = ctx.getAllWithSources();
  let table = "| Setting | Value | Source |\n";
  table += "|---|---|---|\n";
  for (const e of entries) {
    table += `| ${e.key} | ${e.value} | ${e.source} |\n`;
  }

  // Profiles table (no source column)
  const profiles = ctx.profiles;
  const profileNames = Object.keys(profiles).sort();
  if (profileNames.length > 0) {
    table += "\n### Profiles\n\n";
    table += "| Profile | Breadth | Depth | Concurrency | Max Search | Max Elapsed |\n";
    table += "|---|---|---|---|---|---|\n";
    for (const name of profileNames) {
      const p = profiles[name];
      const maxSearch = p.maxSearchCalls !== undefined ? String(p.maxSearchCalls) : "-";
      const maxElapsed = p.maxElapsedSeconds !== undefined ? String(p.maxElapsedSeconds) : "-";
      table += `| ${name} | ${p.breadth} | ${p.depth} | ${p.concurrency} | ${maxSearch} | ${maxElapsed} |\n`;
    }
  }

  return table;
}

/** Build structured JSON for logging. */
export function buildSettingsJson(ctx: SettingsContext): object {
  const entries = ctx.getAllWithSources();
  const settings: Record<string, { value: string | boolean; source: string }> = {};
  for (const e of entries) {
    settings[e.key] = { value: e.value, source: e.source };
  }

  const profiles = ctx.profiles;
  const profilesObj: Record<string, object> = {};
  for (const name of Object.keys(profiles).sort()) {
    const p = profiles[name];
    profilesObj[name] = {
      breadth: p.breadth,
      depth: p.depth,
      concurrency: p.concurrency,
      maxSearchCalls: p.maxSearchCalls ?? null,
      maxElapsedSeconds: p.maxElapsedSeconds ?? null,
    };
  }

  return {
    settings,
    profiles: profilesObj,
  };
}

/** Append a ## Settings section to a report string. */
export function appendSettingsSection(report: string, ctx: SettingsContext): string {
  const table = buildSettingsTable(ctx);
  return `${report}\n## Settings\n\n${table}\n`;
}

/** Write settings JSON log to disk. Always called regardless of toggles. */
export function writeSettingsLog(
  ctx: SettingsContext,
  logDir: string,
  opts: { trigger: "session_start" | "run_start"; runId?: string },
): void {
  const json = buildSettingsJson(ctx);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = opts.trigger === "run_start" && opts.runId ? `${opts.runId}-settings` : `session-settings`;
  const filename = `${prefix}-${timestamp}.json`;
  const path = join(logDir, filename);
  writeFileSync(
    path,
    JSON.stringify(
      { ...json, timestamp: new Date().toISOString(), trigger: opts.trigger, runId: opts.runId ?? null },
      null,
      2,
    ),
  );
}
