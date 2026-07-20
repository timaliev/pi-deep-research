import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { Type } from "typebox";
import { confirmPlanDialog } from "../confirm-dialog.js";
import { type PrefilterManager } from "../prefilter.js";
import { buildIntrospectionPrompt, buildMergePrompt, buildSearchQuery } from "../prefilter-prompts.js";
import type { ProfileResolver } from "../profile-resolver.js";
import type { Scraper } from "../scraper.js";
import type { SearchEngine, searchWeb as SearchWebFn } from "../search/web-search.js";
import { searchWeb } from "../search/web-search.js";
import type { SessionState } from "../session-state.js";
import type { SearchProviderCredentials, SettingsContext } from "../settings-context.js";

/**
 * Call a pi subprocess in JSON mode with a single prompt. Returns the final
 * assistant text output. Pattern from official pi subagent extension.
 */
function callPiJson(
  prompt: string,
  model: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 60_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pi", ["--mode", "json", "-p", "--no-session", "--model", model], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Subprocess timed out"));
    }, timeoutMs);

    if (signal) {
      const onAbort = () => {
        proc.kill("SIGTERM");
        reject(new Error("Aborted"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    let buffer = "";
    let output = "";

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "message_end" && event.message?.role === "assistant") {
            for (const part of event.message.content ?? []) {
              if (part.type === "text") output += part.text;
            }
          }
        } catch {
          // skip unparseable lines
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Subprocess exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.stdin.write(`${prompt}\n`);
    proc.stdin.end();
  });
}

export function createPlanResearchTool(
  _pi: {
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
  return {
    name: "plan_research",
    label: "Plan Research",
    description:
      "Plan a deep research with a single call. Tool handles everything internally: resolves engines/profile from settings, runs preliminary web search, uses a subprocess for LLM introspection and plan creation, then shows TUI confirmation. No params_json or plan_json needed.",
    parameters: Type.Object({
      topic: Type.Optional(Type.String({ description: "Research topic" })),
    }),
    async execute(
      _toolCallId: string,
      params: { topic?: string },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: {
        hasUI?: boolean;
        cwd: string;
        model?: { provider: string; id: string };
      },
    ) {
      const topic = params.topic;
      if (!topic) {
        return {
          content: [{ type: "text", text: "Error: topic is required." }],
          details: { error: "topic_required" },
        };
      }

      mkdirSync(settings.artifactsDir, { recursive: true });

      // ── 1. Resolve engines/profile from settings ────────
      const engines: SearchEngine[] =
        settings.enabledEngines.length > 0 ? (settings.enabledEngines as SearchEngine[]) : ["duckduckgo"];
      const profileName = settings.defaultProfile;

      // ── 2. Subprocess: introspection ────────────────────
      const modelSpec = settings.prefilterModel ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "");
      if (!modelSpec) {
        return {
          content: [{ type: "text", text: "Error: no active model available." }],
          details: { error: "no_model" },
        };
      }

      const introPrompt = buildIntrospectionPrompt(topic);
      let llmTopics = "";
      try {
        llmTopics = await callPiJson(introPrompt, modelSpec, ctx.cwd, signal);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error during LLM introspection: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { error: "introspection_failed" },
        };
      }

      // ── 3. Merge search ─────────────────────────────────
      const searchQuery = buildSearchQuery(topic);
      let mergeResults: Awaited<ReturnType<typeof searchFn>> = [];
      try {
        mergeResults = await searchFn(searchQuery, 5, engines, {
          credentials: searchCred,
        });
      } catch {
        // continue with empty results
      }

      // ── 4. Subprocess: plan creation ────────────────────
      const mergePrompt = buildMergePrompt(topic, llmTopics, mergeResults);
      let planJson: string;
      try {
        planJson = await callPiJson(mergePrompt, modelSpec, ctx.cwd, signal);
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Error during plan creation: ${err instanceof Error ? err.message : String(err)}` },
          ],
          details: { error: "plan_creation_failed" },
        };
      }

      // ── 5. Validate + save via PrefilterManager ──────────
      const manager = new PrefilterManager({
        searchFn,
        scraper,
        artifactsDir: settings.artifactsDir,
        profileResolver,
        searchCred,
        defaultReportStyle: settings.reportStyle,
        enabledEngines: settings.enabledEngines,
      });

      await manager.next({ type: "topic", topic });
      await manager.next({ type: "params", engines, profile: { name: profileName } });
      await manager.next({ type: "continue" });
      await manager.next({ type: "continue", llmResponse: llmTopics });

      const finalResult = await manager.next({ type: "plan", planJson });

      if (finalResult.phase !== "plan_ready" || !finalResult.plan || !finalResult.planArtifactPath) {
        return {
          content: [{ type: "text", text: `Plan validation failed: ${finalResult.error ?? "unknown error"}` }],
          details: { phase: finalResult.phase, error: finalResult.error },
        };
      }

      const plan = finalResult.plan;
      const planPath = finalResult.planArtifactPath;
      const style = plan.reportStyle ?? settings.reportStyle ?? "narrative";

      // ── 6. TUI confirmation ─────────────────────────────

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

      return {
        content: [
          {
            type: "text",
            text: `## Research Plan Ready ✅\n\nPlan saved to: ${planPath}\n\n**Topic:** ${plan.topic}\n**Engines:** ${plan.engines.join(", ")}\n**Profile:** ${plan.profile.name}\n**Style:** ${style}\n**Questions:** ${plan.researchQuestions.length}\n\n▶ Research confirmed. Call run_research to begin.`,
          },
        ],
        details: {
          phase: finalResult.phase,
          plan_artifact_path: planPath,
          plan: finalResult.plan,
          confirmed: true,
        },
      };
    },
  };
}
