import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ResearchPlanProfile } from "../prefilter.js";
import { PrefilterManager, PrefilterSession } from "../prefilter.js";
import type { ProfileResolver } from "../profile-resolver.js";
import type { Scraper } from "../scraper.js";
import type { SearchEngine, searchWeb as SearchWebFn } from "../search/web-search.js";
import { searchWeb } from "../search/web-search.js";
import type { SearchProviderCredentials, SettingsContext } from "../settings-context.js";
import { buildSettingsTable, writeSettingsLog } from "../settings-reporter.js";

export function createPlanResearchTool(
  pi: any,
  settings: SettingsContext,
  profileResolver: ProfileResolver,
  searchCred: SearchProviderCredentials,
  scraper: Scraper,
  searchFn: typeof SearchWebFn = searchWeb,
) {
  const session = new PrefilterSession(
    settings.artifactsDir,
    profileResolver,
    searchCred,
    searchFn,
    scraper,
    settings.reportStyle,
    settings.enabledEngines,
  );

  return {
    name: "plan_research",
    label: "Plan Research",
    description:
      "Three-step research planning. (1) Call with topic — agent proposes engines+profile. (2) Call with topic and params_json — preliminary search runs. (3) Call with topic and plan_json — save plan artifact.",
    parameters: Type.Object({
      topic: Type.Optional(
        Type.String({ description: "Research topic (optional if plan_json provided, extracted from plan)" }),
      ),
      params_json: Type.Optional(Type.String({ description: "JSON with engines and profile (second call)" })),
      plan_json: Type.Optional(Type.String({ description: "JSON research plan (third call)" })),
    }),
    async execute(_toolCallId: string, params: any, _signal: any, onUpdate: any, ctx: any) {
      mkdirSync(settings.artifactsDir, { recursive: true });

      const entries = ctx.sessionManager.getEntries();
      const manager = session.getOrCreate(params.topic ?? "", entries, (runId) =>
        pi.appendEntry("deep-research:prefilter-run", { runId, topic: params.topic }),
      );

      // Step 1: topic only → negotiate params
      if (!params.params_json && !params.plan_json && params.topic) {
        if (!params.topic) {
          return {
            content: [{ type: "text", text: "Error: topic is required for the first call." }],
            details: { error: "missing_topic" },
          };
        }
        const result = await manager.start(params.topic);

        // ADR-0023: inject settings table if onRunStart is enabled
        if (settings.settingsReport.onRunStart) {
          const table = buildSettingsTable(settings);
          pi.sendUserMessage(`## Deep Research Settings\n\n${table}`, { deliverAs: "steer" });
          // Always log settings to disk
          const logsDir = join(settings.artifactsDir, "..", "logs");
          mkdirSync(logsDir, { recursive: true });
          writeSettingsLog(settings, logsDir, { trigger: "run_start", runId: result.runId });
        }

        if (result.inject) pi.sendUserMessage(result.inject, { deliverAs: "steer" });
        return {
          content: [
            {
              type: "text",
              text: `## Research Planning — Phase: ${result.phase}\n\nI've sent you a prompt to choose engines and profile. Respond with JSON, then call plan_research again with params_json.`,
            },
          ],
          details: { phase: result.phase, run_id: result.runId },
        };
      }

      // Step 2: params_json provided → preliminary search
      if (params.params_json && !params.plan_json) {
        if (!params.topic) {
          return {
            content: [{ type: "text", text: "Error: topic is required when providing params_json." }],
            details: { error: "missing_topic" },
          };
        }
        let engines: SearchEngine[];
        let profile: ResearchPlanProfile;
        try {
          const parsed = JSON.parse(params.params_json);
          engines = parsed.engines ?? ["duckduckgo"];
          profile = parsed.profile ?? { name: "default" };
        } catch {
          return {
            content: [{ type: "text", text: "Error: params_json must be valid JSON." }],
            details: { error: "invalid_params_json" },
          };
        }
        const result = await manager.withParams(params.topic, engines, profile);
        if (result.inject) pi.sendUserMessage(result.inject, { deliverAs: "steer" });
        if (result.phase === "awaiting_params") {
          return {
            content: [{ type: "text", text: `## API Key Required\n\nSet missing env vars and retry.` }],
            details: { phase: result.phase, run_id: result.runId },
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Research Planning — Phase: ${result.phase}\n\nPreliminary search complete. ${result.searchResults?.length ?? 0} results. I've sent a prompt to create the plan.`,
            },
          ],
          details: { phase: result.phase, run_id: result.runId },
        };
      }

      // Step 2b: zero params → continue (state-driven routing)
      if (!params.params_json && !params.plan_json && !params.topic) {
        // Extract last assistant response for introspection (ADR-0017)
        const lastAssistant = [...entries].reverse().find((e: any) => e.message?.role === "assistant");
        const llmText = typeof lastAssistant?.message?.content === "string"
          ? (lastAssistant.message.content as string).replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, "").trim()
          : undefined;
        const result = await manager.continue(undefined, llmText);
        if (result.inject) pi.sendUserMessage(result.inject, { deliverAs: "steer" });
        if (result.phase === "error") {
          return { content: [{ type: "text", text: `Error: ${result.error}` }], details: { error: result.error } };
        }
        return {
          content: [
            { type: "text", text: `## Research Planning — Phase: ${result.phase}\n\nContinuing prefilter flow.` },
          ],
          details: { phase: result.phase, run_id: result.runId },
        };
      }

      // Step 3: plan_json provided → finalize
      if (params.plan_json) {
        let topic = params.topic as string;
        if (!topic) {
          try {
            topic = JSON.parse(params.plan_json).topic || "unknown";
          } catch {
            topic = "unknown";
          }
        }
        const result = await manager.finalize(topic, params.plan_json);
        session.remove(result.runId);
        return {
          content: [
            {
              type: "text",
              text:
                result.phase === "plan_ready"
                  ? `## Research Plan Ready ✅\n\nPlan saved to: ${result.planArtifactPath}\n\n**Topic:** ${result.plan?.topic}\n**Engines:** ${result.plan?.engines.join(", ")}\n**Profile:** ${result.plan?.profile.name}\n**Questions:** ${result.plan?.researchQuestions.length}\n\nNext: show user and ask for confirmation before calling run_research.`
                  : `## Plan Error ❌\n\n${result.error}`,
            },
          ],
          details: {
            phase: result.phase,
            plan_artifact_path: result.planArtifactPath,
            plan: result.plan,
            error: result.error,
          },
        };
      }

      return { content: [{ type: "text", text: "Error: unexpected state." }], details: { error: "unexpected_state" } };
    },
  };
}
