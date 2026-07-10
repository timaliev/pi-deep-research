import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { Type } from "typebox";
import { resolveReportPath, writeReportFile } from "../report-assembly.js";
import type { SettingsContext } from "../settings-context.js";

export function createSaveReportTool(settings: SettingsContext) {
  return {
    name: "save_report",
    label: "Save Report",
    description: "Save the final research report as a markdown file.",
    parameters: Type.Object({
      topic: Type.String({ description: "Research topic (used in filename)" }),
      markdown: Type.Optional(Type.String({ description: "Report content in markdown" })),
      report_path: Type.Optional(Type.String({ description: "Path to an existing report file to re-save (for large reports that can't be passed as markdown)" })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      mkdirSync(settings.reportsDir, { recursive: true });

      // Resolve content: report_path (read from disk) takes priority for large files
      let markdown: string;
      if (params.report_path && typeof params.report_path === "string" && existsSync(params.report_path)) {
        markdown = readFileSync(params.report_path, "utf-8");
      } else if (params.markdown && typeof params.markdown === "string") {
        markdown = params.markdown;
      } else {
        return {
          content: [{ type: "text", text: "Error: either markdown or report_path must be provided." }],
          details: { error: "missing_content" },
        };
      }

      const entries = ctx.sessionManager.getEntries();
      const reportPathEntry = [...entries].reverse().find((e: any) => e.customType === "deep-research:report-path");

      // Prefer path pre-computed by run_research auto-save
      const storedRunId = (reportPathEntry?.data as any)?.runId as string | undefined;
      const storedPath = reportPathEntry?.data?.path as string | undefined;

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

      writeReportFile(path, markdown);

      return {
        content: [{ type: "text", text: `Report saved: ${path}` }],
        details: { report_path: path },
      };
    },
  };
}
