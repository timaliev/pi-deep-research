import { Type } from "typebox";
import { existsSync } from "node:fs";
import type { SessionState } from "../session-state.js";

export function createConfirmPlanTool(session: SessionState) {
  return {
    name: "confirm_research",
    label: "Confirm Research",
    description: "Confirm a research plan before running. Call after user explicitly approves the plan and cost estimate.",
    parameters: Type.Object({
      plan_artifact_path: Type.String({ description: "Path to the prefilter.json artifact to confirm" }),
    }),
    async execute(_toolCallId: string, params: any) {
      if (!existsSync(params.plan_artifact_path)) {
        return { content: [{ type: "text", text: `Error: artifact not found at ${params.plan_artifact_path}` }], details: { error: "artifact_not_found" } };
      }
      session.saveConfirmation(params.plan_artifact_path);
      return {
        content: [{ type: "text", text: `## Research Confirmed ✅\n\nPlan: ${params.plan_artifact_path}\n\nReady to run. Call run_research with the plan_artifact_path.` }],
        details: { confirmed: true, plan_artifact_path: params.plan_artifact_path },
      };
    },
  };
}
