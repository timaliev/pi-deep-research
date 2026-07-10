import { join } from "node:path";
import { Type } from "typebox";
import { convertToPdf } from "../export-pdf.js";
import type { SettingsContext } from "../settings-context.js";

export function createExportPdfTool(
  sendUserMessage: (msg: string, opts: any) => void,
  settings: SettingsContext,
) {
  return {
    name: "export_pdf",
    label: "Export PDF",
    description:
      "Export a research report as PDF using pandoc+weasyprint. Falls back to agent-based conversion if pandoc not installed.",
    parameters: Type.Object({
      report_path: Type.String({ description: "Path to the markdown report file" }),
      output_path: Type.Optional(Type.String({ description: "Output PDF path (defaults to same name + .pdf)" })),
    }),
    async execute(_toolCallId: string, params: any) {
      const reportPath = params.report_path as string;
      const outputPath =
        (params.output_path as string | undefined) ??
        join(settings.reportsDir, reportPath.replace(/\.md$/, "") + ".pdf");

      const result = await convertToPdf({ reportPath, outputPath });

      if (result.kind === "error") {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: { error: result.error },
        };
      }

      if (result.kind === "success") {
        return {
          content: [{ type: "text", text: `PDF exported (pandoc): ${result.outputPath}` }],
          details: { pdf_path: result.outputPath, method: result.method },
        };
      }

      // Fallback: agent-based conversion
      sendUserMessage(
        `## PDF Export — Agent Fallback\n\n${result.error}\n\nConvert the report to PDF using available tools:\n` +
          `- Report: ${reportPath}\n- Output: ${result.outputPath}\n\n` +
          `Use print-to-PDF in browser, or any other available PDF tool.`,
        { deliverAs: "steer" },
      );
      return {
        content: [
          {
            type: "text",
            text: `${result.error} Prompt sent for agent-based conversion. Output: ${result.outputPath}`,
          },
        ],
        details: { fallback: true, missing_tools: result.error, pdf_path: result.outputPath },
      };
    },
  };
}
