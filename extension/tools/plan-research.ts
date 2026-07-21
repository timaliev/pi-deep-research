import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { confirmPlanDialog } from "../confirm-dialog.js";
import { generateRunId } from "../ids.js";
import { JsonlLogger } from "../logger.js";
import { buildIntrospectionPrompt, buildMergePrompt, buildSearchQuery } from "../prefilter-prompts.js";
import type { ProfileResolver } from "../profile-resolver.js";
import type { Scraper } from "../scraper.js";
import type { SearchEngine, searchWeb as SearchWebFn } from "../search/web-search.js";
import { searchWeb } from "../search/web-search.js";
import type { SessionState } from "../session-state.js";
import type { SearchProviderCredentials, SettingsContext } from "../settings-context.js";
import { callPiJson } from "../subprocess-runner.js";
import { validateAndSavePlan } from "../validate-and-save.js";
import { writeSettingsLog } from "../settings-reporter.js";

/** Replace LLM-written estimatedCost with tool-computed values (ADR-0027). */
function injectEstimatedCost(planJson: string): string {
  try {
    const plan = JSON.parse(planJson);
    const questions = plan.researchQuestions?.length ?? 1;
    const breadth = plan.profile?.breadth ?? 4;
    const depth = plan.profile?.depth ?? 2;
    const searches = breadth * depth * questions;
    const scrapes = Math.ceil(searches * 1.5);
    plan.estimatedCost = {
      searchCalls: searches,
      scrapeCalls: scrapes,
      description: `~${searches} searches, ~${scrapes} scrapes`,
    };
    return JSON.stringify(plan);
  } catch {
    return planJson;
  }
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
      onUpdate: (update: { content: { type: string; text: string }[] }) => void,
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

      // ── 0. Setup logging ──────────────────────────────
      const runId = generateRunId();
      const logsDir = join(settings.artifactsDir, "..", "logs");
      mkdirSync(logsDir, { recursive: true });
      const logger = new JsonlLogger(runId, join(logsDir, `${runId}-prefilter.log`));
      logger.event("prefilter_started", { topic });
      writeSettingsLog(settings, logsDir, { trigger: "run_start", runId });

      const progress = (msg: string) => onUpdate({ content: [{ type: "text", text: msg }] });
      const isVerbose = settings.logLevel === "verbose";
      const vlog = (type: string, data: Record<string, unknown>) => {
        if (isVerbose) logger.event(type, data);
      };

      // ── 1. Resolve engines/profile from settings ────────
      const engines: SearchEngine[] =
        settings.enabledEngines.length > 0 ? (settings.enabledEngines as SearchEngine[]) : ["duckduckgo"];
      const profileName = settings.defaultProfile;

      // ── 2. Subprocess: introspection ────────────────────
      progress(`🔍 Researching: ${topic}`);
      logger.event("prefilter_introspection_start");
      const introStart = Date.now();

      const modelSpec = settings.prefilterModel ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "");
      if (!modelSpec) {
        return {
          content: [{ type: "text", text: "Error: no active model available." }],
          details: { error: "no_model" },
        };
      }

      const introPrompt = buildIntrospectionPrompt(topic);
      vlog("prefilter_model", { model: modelSpec, timeoutMs: settings.prefilterTimeoutMs });
      vlog("prefilter_introspection_prompt", { length: introPrompt.length });

      let llmTopics = "";
      try {
        llmTopics = await callPiJson(introPrompt, modelSpec, ctx.cwd, signal, settings.prefilterTimeoutMs, (chunk) => {
          if (settings.logLevel === "verbose") progress(`📖 ${chunk.slice(-80)}`);
        });
        logger.event("prefilter_introspection_done", { length: llmTopics.length, durationMs: Date.now() - introStart });
        vlog("prefilter_introspection_result", { topics: llmTopics.substring(0, 500) });
        const introSecs = ((Date.now() - introStart) / 1000).toFixed(1);
        progress(`📚 Introspection complete (${introSecs}s) — merging with web results...`);
      } catch (err) {
        logger.event("prefilter_introspection_failed", { error: err instanceof Error ? err.message : String(err) });
        // Retry once on failure
        progress("⚠️ Introspection failed — retrying...");
        try {
          llmTopics = await callPiJson(introPrompt, modelSpec, ctx.cwd, signal, settings.prefilterTimeoutMs);
          logger.event("prefilter_introspection_retry_done", {
            length: llmTopics.length,
            durationMs: Date.now() - introStart,
          });
        } catch {
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
      }

      // ── 3. Merge search ─────────────────────────────────
      progress("🌐 Searching web for relevant sources...");
      const searchStart = Date.now();
      const searchQuery = buildSearchQuery(topic);
      vlog("prefilter_search_query", { query: searchQuery, engines, maxResults: 5 });
      let mergeResults: Awaited<ReturnType<typeof searchFn>> = [];
      try {
        mergeResults = await searchFn(searchQuery, 5, engines, {
          credentials: searchCred,
        });
        logger.event("prefilter_search_done", {
          resultCount: mergeResults.length,
          durationMs: Date.now() - searchStart,
        });
        const searchSecs = ((Date.now() - searchStart) / 1000).toFixed(1);
        if (isVerbose) progress(`🌐 Search done (${searchSecs}s, ${mergeResults.length} results)`);
      } catch {
        // continue with empty results
      }

      // Scrape top results for full content
      const scrapedContent: { url: string; title: string; content: string }[] = [];
      for (const result of mergeResults.slice(0, settings.prefilterScrapeCount)) {
        try {
          const page = await scraper.scrape(result.url);
          page.content = page.content.substring(0, settings.prefilterScrapeChars);
          scrapedContent.push(page);
        } catch {
          // skip failed scrapes
        }
      }

      // ── 4. Subprocess: plan creation ────────────────────
      progress("📝 Creating research plan...");
      logger.event("prefilter_plan_creation_start");
      const planStart = Date.now();
      const mergePrompt = buildMergePrompt(
        topic,
        llmTopics,
        mergeResults,
        scrapedContent,
        settings.enabledEngines,
        profileName,
        settings.reportStyle,
      );
      let planJson: string;
      try {
        planJson = await callPiJson(mergePrompt, modelSpec, ctx.cwd, signal, settings.prefilterTimeoutMs, (chunk) => {
          if (settings.logLevel === "verbose") progress(`📝 ${chunk.slice(-80)}`);
        });
        logger.event("prefilter_plan_creation_done", { length: planJson.length, durationMs: Date.now() - planStart });
        vlog("prefilter_plan_raw", { planJson });

        // Inject computed estimatedCost (ADR-0027 — tool computes, not LLM)
        planJson = injectEstimatedCost(planJson);

        const planSecs = ((Date.now() - planStart) / 1000).toFixed(1);
        progress(`✅ Plan created (${planSecs}s) — validating...`);
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Error during plan creation: ${err instanceof Error ? err.message : String(err)}` },
          ],
          details: { error: "plan_creation_failed" },
        };
      }

      // ── 5. Validate + save ─────────────────────────────
      let saveResult = await validateAndSavePlan({
        planJson,
        topic,
        engines,
        profileName,
        artifactsDir: settings.artifactsDir,
        enabledEngines: settings.enabledEngines,
        profileNames: profileResolver.listNames(),
        reportStyle: settings.reportStyle,
        runId,
      });

      // ── 5a. Retry on JSON parse failure ────────────────
      if (!saveResult.ok && saveResult.error.includes("JSON")) {
        logger.event("prefilter_plan_retry");
        progress("⚠️ Plan JSON invalid — retrying with stricter prompt...");
        const retryPrompt = `${mergePrompt}\n\nYour previous response was not valid JSON. Reply with ONLY the JSON object — no markdown, no explanation:\n\n{ "topic": "...", "goal": "...", ... }`;
        try {
          planJson = await callPiJson(retryPrompt, modelSpec, ctx.cwd, signal, settings.prefilterTimeoutMs);
          planJson = injectEstimatedCost(planJson);
          logger.event("prefilter_plan_retry_done", { length: planJson.length });
          vlog("prefilter_plan_retry_raw", { planJson });
          saveResult = await validateAndSavePlan({
            planJson,
            topic,
            engines,
            profileName,
            artifactsDir: settings.artifactsDir,
            enabledEngines: settings.enabledEngines,
            profileNames: profileResolver.listNames(),
            reportStyle: settings.reportStyle,
            runId,
          });
        } catch (err) {
          logger.event("prefilter_plan_retry_failed", { error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (!saveResult.ok) {
        logger.event("prefilter_validation_failed", { error: saveResult.error });
        return {
          content: [{ type: "text", text: `Plan validation failed: ${saveResult.error}` }],
          details: { phase: "error", error: saveResult.error },
        };
      }

      const plan = saveResult.plan;
      const planPath = saveResult.planArtifactPath;
      const style = plan.reportStyle ?? settings.reportStyle ?? "narrative";

      logger.event("prefilter_plan_saved", {
        planPath,
        questions: plan.researchQuestions.length,
        engines: plan.engines,
      });
      progress(`📋 Plan ready: ${plan.researchQuestions.length} questions — waiting for confirmation...`);

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
        logger.event("prefilter_cancelled", { planPath });
        return {
          content: [
            { type: "text", text: "## Plan Cancelled ❌\n\nPlan discarded. Start a new research topic when ready." },
          ],
          details: { phase: "cancelled", plan_artifact_path: planPath },
        };
      }

      sessionState.saveConfirmation(planPath);
      logger.event("prefilter_confirmed", { planPath });

      return {
        content: [
          {
            type: "text",
            text: `## Research Plan Ready ✅\n\nPlan saved to: ${planPath}\n\n**Topic:** ${plan.topic}\n**Engines:** ${plan.engines.join(", ")}\n**Profile:** ${plan.profile.name}\n**Style:** ${style}\n**Questions:** ${plan.researchQuestions.length}\n\n▶ Research confirmed. Call run_research to begin.`,
          },
        ],
        details: {
          phase: "plan_ready",
          plan_artifact_path: planPath,
          plan: saveResult.plan,
          confirmed: true,
        },
      };
    },
  };
}
