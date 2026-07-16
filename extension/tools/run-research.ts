import { Type } from "typebox";
import type { ResearchRunOrchestrator } from "../research-run-orchestrator.js";
import { CONFIRMATION_KEY } from "../session-state.js";
import type { SessionState } from "../session-state.js";
import type { SettingsContext } from "../settings-context.js";

export function createRunResearchTool(
  pi: any,
  orchestrator: ResearchRunOrchestrator,
  settings: SettingsContext,
  session: SessionState,
) {
  return {
    name: "run_research",
    label: "Run Research",
    description:
      "Execute the deep research state machine. Call repeatedly until phase='done'. Each call advances the research by one or more phases. On the first call, pass plan_artifact_path. On subsequent calls, pass nothing — the tool manages its own state.",
    parameters: Type.Object({
      plan_artifact_path: Type.Optional(Type.String({ description: "Path to prefilter.json (first call only)" })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const entries = ctx.sessionManager.getEntries();

      // Confirmation gate — only for first call
      if (params.plan_artifact_path) {
        const confirmed = [...entries].reverse().find((e: any) => e.customType === CONFIRMATION_KEY);
        if (!confirmed) {
          return {
            content: [
              {
                type: "text",
                text: `## Confirmation Required ⚠️\n\nThe research plan must be confirmed by the user before running.\n\n1. Present the plan and cost estimate to the user\n2. Ask for explicit approval\n3. After approval, call confirm_research with the plan path\n4. Then call run_research`,
              },
            ],
            details: { error: "plan_not_confirmed" },
          };
        }
        const confirmedPath = confirmed.data?.planArtifactPath as string | undefined;
        if (confirmedPath && confirmedPath !== params.plan_artifact_path) {
          return {
            content: [
              {
                type: "text",
                text: `## Plan Mismatch ⚠️\n\nConfirmation is for a different plan (${confirmedPath}). Present this plan to the user and re-confirm.`,
              },
            ],
            details: { error: "plan_mismatch" },
          };
        }
      }

      const result = await orchestrator.handle({
        planArtifactPath: params.plan_artifact_path,
        entries: [...entries] as any[],
      });

      if (result.kind === "error") {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: result.details ?? {},
        };
      }

      if (result.kind === "in_progress" && result.inject) {
        pi.sendUserMessage(result.inject, { deliverAs: "steer" });
      }

      if (result.kind === "done") {
        const reportPath = result.reportPath;
        if (reportPath) {
          session.saveReportPath(reportPath, settings.reportsDir, result.snapshot.runId);
        }

        let pdfInfo = "";
        if (result.pdfResult?.kind === "fallback") {
          pdfInfo = `\n💡 PDF export failed (${result.pdfResult.error}). Call export_pdf to retry on demand.`;
        } else if (result.pdfResult?.kind === "success") {
          pdfInfo = `\nPDF exported: ${result.pdfResult.outputPath}`;
        }

        let mindMapInfo = "";
        if (result.mindMapPrompt) {
          mindMapInfo = `\n💡 Mind map available. Call mind_map to generate.`;
        }

        return {
          content: [
            {
              type: "text",
              text: `## Research Complete ✅\n\nReport saved to: ${reportPath}${pdfInfo}${mindMapInfo}\n\nSearch calls: ${result.snapshot.searchCalls}\nScrape calls: ${result.snapshot.scrapeCalls}\nSources visited: ${result.snapshot.allVisitedUrls.length}`,
            },
          ],
          details: { phase: "done", report_path: reportPath, run_id: result.snapshot.runId },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `## Research In Progress\n\nPhase: ${result.snapshot.phase}\nDepth: ${result.snapshot.currentDepth}/${result.snapshot.totalDepth}\nSearch calls: ${result.snapshot.searchCalls}\nScrape calls: ${result.snapshot.scrapeCalls}\n\n${result.inject ? "I've sent you a prompt. Respond, then call run_research again." : "Call run_research again to continue."}`,
          },
        ],
        details: { phase: result.snapshot.phase, run_id: result.snapshot.runId },
      };
    },
  };
}
