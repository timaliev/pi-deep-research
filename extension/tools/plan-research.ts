import { mkdirSync } from "node:fs";
import { Type } from "typebox";
import { confirmPlanDialog } from "../confirm-dialog.js";
import type { ResearchPlanProfile } from "../prefilter.js";
import { type PrefilterManager, PrefilterSession } from "../prefilter.js";
import type { ProfileResolver } from "../profile-resolver.js";
import type { Scraper } from "../scraper.js";
import type { SearchEngine, searchWeb as SearchWebFn } from "../search/web-search.js";
import { searchWeb } from "../search/web-search.js";
import { PREFILTER_RUN_KEY } from "../session-state.js";
import type { SessionState } from "../session-state.js";
import type { SearchProviderCredentials, SettingsContext } from "../settings-context.js";

export function createPlanResearchTool(
  pi: any,
  settings: SettingsContext,
  profileResolver: ProfileResolver,
  searchCred: SearchProviderCredentials,
  sessionState: SessionState,
  scraper: Scraper,
  searchFn: typeof SearchWebFn = searchWeb,
) {
  const session = new PrefilterSession({
    artifactsDir: settings.artifactsDir,
    profileResolver,
    searchCred,
    searchFn,
    scraper,
    defaultReportStyle: settings.reportStyle,
    enabledEngines: settings.enabledEngines,
  });

  // ─── Handler methods ──────────────────────────────────────

  async function handleStart(topic: string, manager: PrefilterManager) {
    const result = await manager.start(topic);
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

  async function handleWithParams(topic: string, paramsJson: string, manager: PrefilterManager) {
    let engines: SearchEngine[];
    let profile: ResearchPlanProfile;
    try {
      const parsed = JSON.parse(paramsJson);
      engines = parsed.engines ?? ["duckduckgo"];
      profile = parsed.profile ?? { name: "default" };
    } catch {
      return {
        content: [{ type: "text", text: "Error: params_json must be valid JSON." }],
        details: { error: "invalid_params_json" },
      };
    }
    const result = await manager.withParams(topic, engines, profile);
    if (result.inject) pi.sendUserMessage(result.inject, { deliverAs: "steer" });
    if (result.phase === "awaiting_params") {
      return {
        content: [{ type: "text", text: "## API Key Required\n\nSet missing env vars and retry." }],
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

  async function handleContinue(entries: any[], manager: PrefilterManager) {
    // ADR-0017: extract LLM response for introspection flow
    const lastAssistant = [...entries].reverse().find((e: any) => e.message?.role === "assistant");
    const llmText =
      typeof lastAssistant?.message?.content === "string"
        ? (lastAssistant.message.content as string).replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, "").trim()
        : undefined;
    const result = await manager.continue(undefined, llmText);
    if (result.inject) pi.sendUserMessage(result.inject, { deliverAs: "steer" });
    if (result.phase === "error") {
      return { content: [{ type: "text", text: `Error: ${result.error}` }], details: { error: result.error } };
    }
    return {
      content: [{ type: "text", text: `## Research Planning — Phase: ${result.phase}\n\nContinuing prefilter flow.` }],
      details: { phase: result.phase, run_id: result.runId },
    };
  }

  async function handleFinalize(topic: string | undefined, planJson: string, manager: PrefilterManager, ctx: any) {
    let resolvedTopic = topic as string;
    if (!resolvedTopic) {
      try {
        resolvedTopic = JSON.parse(planJson).topic || "unknown";
      } catch {
        resolvedTopic = "unknown";
      }
    }
    const result = await manager.finalize(resolvedTopic, planJson);
    session.remove(result.runId);

    if (result.phase !== "plan_ready" || !result.plan || !result.planArtifactPath) {
      return {
        content: [{ type: "text", text: `## Plan Error ❌\n\n${result.error}` }],
        details: { phase: result.phase, error: result.error },
      };
    }

    const plan = result.plan;
    const planPath = result.planArtifactPath;

    // Inline confirmation — skip LLM, ask user directly (idempotent via shared dialog)
    const confirmed = await confirmPlanDialog(ctx, plan, profileResolver, settings);
    if (confirmed) {
      sessionState.saveConfirmation(planPath);
    }

    const confirmationNote = confirmed
      ? `\n\n▶ Research confirmed. Call run_research to begin.`
      : ctx.hasUI
        ? `\n\n⏸ Research not confirmed. Call confirm_research when ready.`
        : `\n\nNext: show user and ask for confirmation before calling run_research.`;

    return {
      content: [
        {
          type: "text",
          text: `## Research Plan Ready ✅\n\nPlan saved to: ${planPath}\n\n**Topic:** ${plan.topic}\n**Engines:** ${plan.engines.join(", ")}\n**Profile:** ${plan.profile.name}\n**Questions:** ${plan.researchQuestions.length}${confirmationNote}`,
        },
      ],
      details: {
        phase: result.phase,
        plan_artifact_path: planPath,
        plan: result.plan,
        confirmed,
      },
    };
  }

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
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      mkdirSync(settings.artifactsDir, { recursive: true });
      const entries = ctx.sessionManager.getEntries();
      const manager = session.getOrCreate(params.topic ?? "", entries, (runId) =>
        pi.appendEntry(PREFILTER_RUN_KEY, { runId, topic: params.topic }),
      );

      // Router — 4 branches, one per protocol step
      if (!params.params_json && !params.plan_json && params.topic) {
        return handleStart(params.topic, manager);
      }
      if (params.params_json && !params.plan_json) {
        return handleWithParams(params.topic, params.params_json, manager);
      }
      if (!params.params_json && !params.plan_json && !params.topic) {
        return handleContinue(entries, manager);
      }
      if (params.plan_json) {
        return handleFinalize(params.topic, params.plan_json, manager, ctx);
      }
      return { content: [{ type: "text", text: "Error: unexpected state." }], details: { error: "unexpected_state" } };
    },
  };
}
