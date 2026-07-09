import { Type } from "typebox";
import type { SessionState } from "../session-state.js";
import { readPlanArtifact } from "./shared.js";

export function createConfirmPlanTool(session: SessionState) {
  return {
    name: "confirm_research",
    label: "Confirm Research",
    description:
      "Confirm a research plan before running. Call after user explicitly approves the plan and cost estimate.",
    parameters: Type.Object({
      plan_artifact_path: Type.String({ description: "Path to the prefilter.json artifact to confirm" }),
    }),
    async execute(_toolCallId: string, params: any) {
      const result = readPlanArtifact(params.plan_artifact_path);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error} — ${result.path}` }],
          details: { error: result.error },
        };
      }
      session.saveConfirmation(params.plan_artifact_path);
      return {
        content: [
          {
            type: "text",
            text: `## Research Confirmed ✅\n\nPlan: ${params.plan_artifact_path}\n\nReady to run. Call run_research with the plan_artifact_path.`,
          },
        ],
        details: { confirmed: true, plan_artifact_path: params.plan_artifact_path },
      };
    },
  };
}
