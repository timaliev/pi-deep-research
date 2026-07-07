import { Type } from "typebox";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolveReportPath } from "../report-assembly.js";
import type { SettingsContext } from "../settings-context.js";

export function createSaveReportTool(settings: SettingsContext) {
  return {
    name: "save_report",
    label: "Save Report",
    description: "Save the final research report as a markdown file.",
    parameters: Type.Object({
      topic: Type.String({ description: "Research topic (used in filename)" }),
      markdown: Type.String({ description: "Report content in markdown" }),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      mkdirSync(settings.reportsDir, { recursive: true });

      const entries = ctx.sessionManager.getEntries();
      const reportPathEntry = [...entries].reverse().find((e: any) => e.customType === "deep-research:report-path");

      // Prefer path pre-computed by run_research auto-save
      // Only reuse if the stored path was generated from the same topic
      let path: string;
      const storedRunId = (reportPathEntry?.data as any)?.runId as string | undefined;
      const storedPath = reportPathEntry?.data?.path as string | undefined;
      const storedTelemetry = (reportPathEntry?.data as any)?.telemetry as string | undefined;

      if (storedPath && typeof storedPath === "string" && storedRunId) {
        // Check if stored path matches what we'd generate for this topic
        const expectedPath = resolveReportPath(params.topic, settings.reportsDir, storedRunId);
        if (storedPath === expectedPath) {
          path = storedPath;
          if (storedTelemetry && !params.markdown.includes("## Research Telemetry")) {
            const reportWithTelemetry = `${params.markdown}\n\n${storedTelemetry}\n`;
            writeFileSync(path, reportWithTelemetry, "utf-8");
            return {
              content: [{ type: "text", text: `Report saved (with telemetry): ${path}` }],
              details: { report_path: path },
            };
          }
        } else {
          // Stale path from different run — generate fresh path
          path = resolveReportPath(params.topic, settings.reportsDir);
          mkdirSync(settings.reportsDir, { recursive: true });
        }
      } else if (storedPath && typeof storedPath === "string") {
        // Legacy: no runId in entry — keep backward compat but write fresh content
        path = storedPath;
        if (storedTelemetry && !params.markdown.includes("## Research Telemetry")) {
          const reportWithTelemetry = `${params.markdown}\n\n${storedTelemetry}\n`;
          writeFileSync(path, reportWithTelemetry, "utf-8");
          return {
            content: [{ type: "text", text: `Report saved (with telemetry): ${path}` }],
            details: { report_path: path },
          };
        }
      } else {
        path = resolveReportPath(params.topic, settings.reportsDir);
        mkdirSync(settings.reportsDir, { recursive: true });
      }

      writeFileSync(path, params.markdown, "utf-8");

      return {
        content: [{ type: "text", text: `Report saved: ${path}` }],
        details: { report_path: path },
      };
    },
  };
}
