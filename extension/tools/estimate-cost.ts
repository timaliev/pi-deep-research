import { Type } from "typebox";
import { existsSync, readFileSync } from "node:fs";
import type { ProfileResolver } from "../profile-resolver.js";
import type { PrefilterArtifact } from "../prefilter.js";

export function createEstimateCostTool(profileResolver: ProfileResolver) {
  return {
    name: "estimate_research_cost",
    label: "Estimate Research Cost",
    description: "Estimate the cost of running a deep research (in API calls). Reads a plan artifact and calculates search/scrape calls based on the profile.",
    parameters: Type.Object({
      plan_artifact_path: Type.String({ description: "Path to the prefilter.json artifact" }),
    }),
    async execute(_toolCallId: string, params: any) {
      if (!existsSync(params.plan_artifact_path)) {
        return { content: [{ type: "text", text: `Error: artifact not found at ${params.plan_artifact_path}` }], details: { error: "artifact_not_found" } };
      }
      const raw = readFileSync(params.plan_artifact_path, "utf-8");
      const artifact: PrefilterArtifact = JSON.parse(raw);
      const profile = profileResolver.resolve(artifact.plan.profile);
      const estSearches = profile.breadth * profile.depth * artifact.plan.researchQuestions.length;
      const estScrapes = Math.ceil(estSearches * 1.5);
      return {
        content: [{ type: "text", text: [
          `## Research Cost Estimate`,
          ``,
          `**Profile:** ${artifact.plan.profile.name} (breadth=${profile.breadth}, depth=${profile.depth})`,
          `**Engines:** ${artifact.plan.engines.join(", ")}`,
          `**Questions:** ${artifact.plan.researchQuestions.length}`,
          `**Estimated searches:** ~${estSearches}`,
          `**Estimated scrapes:** ~${estScrapes}`,
        ].join("\n") }],
        details: { estimated_searches: estSearches, estimated_scrapes: estScrapes },
      };
    },
  };
}
