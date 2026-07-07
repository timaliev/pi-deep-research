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
      let path: string;
      if (reportPathEntry?.data?.path && typeof reportPathEntry.data.path === "string") {
        path = reportPathEntry.data.path;
        const telemetry = (reportPathEntry.data as any).telemetry as string | undefined;
        if (telemetry && !params.markdown.includes("## Research Telemetry")) {
          const reportWithTelemetry = `${params.markdown}\n\n${telemetry}\n`;
          writeFileSync(path, reportWithTelemetry, "utf-8");
          return {
            content: [{ type: "text", text: `Report saved (with telemetry): ${path}` }],
            details: { report_path: path },
          };
        }
      } else {
        const runId = (reportPathEntry?.data as any)?.runId as string | undefined;
        path = resolveReportPath(params.topic, settings.reportsDir, runId);
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
