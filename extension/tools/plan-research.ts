import { mkdirSync } from "node:fs";
import { Type } from "typebox";
import { confirmPlanDialog } from "../confirm-dialog.js";
import { type PrefilterManager, PrefilterSession } from "../prefilter.js";
import type { ProfileResolver } from "../profile-resolver.js";
import type { Scraper } from "../scraper.js";
import type { SearchEngine, searchWeb as SearchWebFn } from "../search/web-search.js";
import { searchWeb } from "../search/web-search.js";
import { PREFILTER_RUN_KEY } from "../session-state.js";
import type { SessionState } from "../session-state.js";
import type { SearchProviderCredentials, SettingsContext } from "../settings-context.js";

/** Extract agent's last text response from session entries, stripping tool calls. */
function parseAgentResponse(entries: Record<string, unknown>[]): string {
  const lastAssistant = [...entries]
    .reverse()
    .find((e) => (e as { message?: { role?: string } }).message?.role === "assistant");
  if (!lastAssistant) return "";

  const content = (lastAssistant as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") {
    return content.replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, "").trim();
  }
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string; text?: string }) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, "")
      .trim();
  }
  return "";
}

/** Extract JSON object from agent response text (handles markdown fences). */
function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence?.[1]?.trim() ?? text.trim();

  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    // try to find JSON object anywhere in text
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]) as Record<string, unknown>;
      } catch {
        // fall through
      }
    }
  }
  return null;
}

export function createPlanResearchTool(
  pi: {
    sendUserMessage: (msg: string, opts?: { deliverAs: string }) => void;
    appendEntry: (key: string, data: unknown) => void;
  },
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

  return {
    name: "plan_research",
    label: "Plan Research",
    description:
      "Plan a deep research. Call once with topic — tool auto-advances through engine/profile selection, LLM introspection, preliminary web search, and plan creation. Just respond to injected prompts. No params_json or plan_json needed.",
    parameters: Type.Object({
      topic: Type.Optional(
        Type.String({ description: "Research topic (required on first call, omit on subsequent calls)" }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { topic?: string },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: { sessionManager: { getEntries: () => Record<string, unknown>[] }; hasUI?: boolean },
    ) {
      mkdirSync(settings.artifactsDir, { recursive: true });
      const entries = ctx.sessionManager.getEntries();

      // Find existing manager from session entries when topic not provided
      const resolvedTopic = params.topic ?? "";
      const manager = session.getOrCreate(resolvedTopic, entries, (runId) =>
        pi.appendEntry(PREFILTER_RUN_KEY, { runId, topic: params.topic }),
      );

      const phase = manager.getPhase();
      const agentText = parseAgentResponse(entries);

      let result: Awaited<ReturnType<PrefilterManager["next"]>>;

      // ── Phase dispatch ──────────────────────────────────

      if (phase === "awaiting_params") {
        const json = extractJson(agentText);
        if (json && (json.engines || json.profile)) {
          // Agent responded with engine/profile choice → advance to params + auto-introspect
          result = await manager.next({
            type: "params",
            engines: (json.engines as SearchEngine[]) ?? ["duckduckgo"],
            profile: (json.profile as { name: string; breadth?: number; depth?: number; concurrency?: number }) ?? {
              name: "default",
            },
          });
          if (result.phase === "awaiting_plan") {
            result = await manager.next({ type: "continue" });
          }
        } else {
          // Fresh start — no agent response yet
          if (!params.topic) {
            return {
              content: [
                { type: "text", text: "Error: topic is required on first call. Use plan_research({ topic: '...' })." },
              ],
              details: { error: "topic_required" },
            };
          }
          result = await manager.next({ type: "topic", topic: params.topic });
        }
      } else if (phase === "introspecting") {
        // Agent responded to introspection prompt → trigger merge search
        result = await manager.next({ type: "continue", llmResponse: agentText || undefined });
      } else if (phase === "merging") {
        // Agent responded to merge prompt with plan → finalize
        const json = extractJson(agentText);
        if (!json || !json.researchQuestions) {
          // Self-recovering: re-inject merge prompt (ADR-0027 refinement)
          result = await manager.next({ type: "continue", llmResponse: agentText || undefined });
          if (result.inject) pi.sendUserMessage(result.inject, { deliverAs: "steer" });
          return {
            content: [
              {
                type: "text",
                text: "## Plan Required\n\nI couldn't find a valid plan with researchQuestions in your response. I've re-sent the merge prompt. Please respond with a complete plan JSON.",
              },
            ],
            details: { phase: result.phase, run_id: result.runId },
          };
        }
        result = await manager.next({ type: "plan", planJson: JSON.stringify(json) });
      } else {
        return {
          content: [{ type: "text", text: `Error: unknown prefilter phase "${phase}".` }],
          details: { error: "unknown_phase" },
        };
      }

      // ── Error handling ──────────────────────────────────

      if (result.phase === "error") {
        // Self-recovering: if introspection was skipped, auto-trigger it (ADR-0027 refinement)
        if (result.error?.includes("introspection") && phase === "awaiting_params") {
          result = await manager.next({ type: "continue" });
        } else {
          return {
            content: [{ type: "text", text: `Error: ${result.error}` }],
            details: { phase: result.phase, error: result.error },
          };
        }
      }

      // ── Injection ───────────────────────────────────────

      if (result.inject) {
        pi.sendUserMessage(result.inject, { deliverAs: "steer" });
      }

      // ── Plan ready → TUI confirmation ───────────────────

      if (result.phase === "plan_ready" && result.plan && result.planArtifactPath) {
        const plan = result.plan;
        const planPath = result.planArtifactPath;
        const style = plan.reportStyle ?? settings.reportStyle ?? "narrative";

        if (!ctx.hasUI) {
          return {
            content: [
              {
                type: "text",
                text: "## Error ❌\n\nResearch plan requires interactive TUI confirmation. Non-interactive mode is not supported.",
              },
            ],
            details: { phase: "error", error: "non_interactive_not_supported", plan_artifact_path: planPath },
          };
        }

        const dialogResult = await confirmPlanDialog(
          ctx as Parameters<typeof confirmPlanDialog>[0],
          plan,
          profileResolver,
          settings,
          planPath,
        );
        if (dialogResult.cancelled) {
          return {
            content: [
              { type: "text", text: "## Plan Cancelled ❌\n\nPlan discarded. Start a new research topic when ready." },
            ],
            details: { phase: "cancelled", plan_artifact_path: planPath },
          };
        }

        sessionState.saveConfirmation(planPath);
        session.remove(result.runId);

        return {
          content: [
            {
              type: "text",
              text: `## Research Plan Ready ✅\n\nPlan saved to: ${planPath}\n\n**Topic:** ${plan.topic}\n**Engines:** ${plan.engines.join(", ")}\n**Profile:** ${plan.profile.name}\n**Style:** ${style}\n**Questions:** ${plan.researchQuestions.length}\n\n▶ Research confirmed. Call run_research to begin.`,
            },
          ],
          details: {
            phase: result.phase,
            plan_artifact_path: planPath,
            plan: result.plan,
            confirmed: true,
          },
        };
      }

      // ── In progress ─────────────────────────────────────

      return {
        content: [
          {
            type: "text",
            text: `## Research Planning — Phase: ${result.phase}\n\n${result.inject ? "I've sent you a prompt. Respond in your next message, then call plan_research again." : "Call plan_research again to continue."}`,
          },
        ],
        details: { phase: result.phase, run_id: result.runId },
      };
    },
  };
}
