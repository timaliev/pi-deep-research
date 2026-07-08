import { Type } from "typebox";
import { mkdirSync } from "node:fs";
import { resolveReportPath, writeReportFile } from "../report-assembly.js";
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
      const storedRunId = (reportPathEntry?.data as any)?.runId as string | undefined;
      const storedPath = reportPathEntry?.data?.path as string | undefined;
      const storedTelemetry = (reportPathEntry?.data as any)?.telemetry as string | undefined;

      let path: string;
      if (storedPath && typeof storedPath === "string" && storedRunId) {
        const expectedPath = resolveReportPath(params.topic, settings.reportsDir, storedRunId);
        if (storedPath === expectedPath) {
          path = storedPath;
        } else {
          // Stale path from different run — generate fresh
          path = resolveReportPath(params.topic, settings.reportsDir);
          mkdirSync(settings.reportsDir, { recursive: true });
        }
      } else if (storedPath && typeof storedPath === "string") {
        // Legacy: no runId — keep backward compat
        path = storedPath;
      } else {
        path = resolveReportPath(params.topic, settings.reportsDir);
        mkdirSync(settings.reportsDir, { recursive: true });
      }

      writeReportFile(path, params.markdown, storedTelemetry);

      const hasTelemetry = storedTelemetry && !params.markdown.includes("## Research Telemetry");
      return {
        content: [{ type: "text", text: `Report saved${hasTelemetry ? " (with telemetry)" : ""}: ${path}` }],
        details: { report_path: path },
      };
    },
  };
}
