import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { searchWeb, multiEngineWebSearch } from "./search/web-search.js";
import type { SearchEngine } from "./search/web-search.js";
import { WebScraper } from "./scraper.js";
import { JsonlLogger } from "./logger.js";
import { PrefilterManager } from "./prefilter.js";
import { ResearchStateMachine, buildTelemetrySection, readExtensionVersion, DEFAULT_PRESETS } from "./state-machine.js";
import type { ResearchPlan, PrefilterArtifact, ResearchPlanProfile } from "./prefilter.js";
import type { ResearchSnapshot } from "./state-machine.js";
import { topicToSlug } from "./slug.js";
import { ProfileResolver, loadDeepResearchSettings } from "./profile-resolver.js";
import type { DeepResearchSettings } from "./profile-resolver.js";
import { loadSearchProviders, SearchProviderCredentials } from "./search-providers.js";

const baseDir = dirname(fileURLToPath(import.meta.url));

const rootDir = join(baseDir, "..");

export default function (pi: ExtensionAPI) {
  // Load user settings and create unified profile resolver
  const settings = loadDeepResearchSettings();
  const profileResolver = new ProfileResolver(settings.profiles ?? {}, settings.defaultProfile);
  const reportsDir = settings.reportsDir ?? join(baseDir, "..", "..", "deep-research", "reports");
  const artifactsDir = settings.artifactsDir ?? join(baseDir, "..", "..", "deep-research", "artifacts");
  const searchProviders = loadSearchProviders(join(homedir(), ".pi", "agent", "settings.json"));
  const searchCred = new SearchProviderCredentials(searchProviders);

  // Contribute the skill file
  pi.on("resources_discover", () => ({
    skillPaths: [join(baseDir, "..", "skill", "SKILL.md")],
  }));

  // === TOOL: web_search ===
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: `Search the web using multiple search engines with delays to emulate user behavior.
Returns results with title, URL, and snippet.
Use for finding sources during research or when you need up-to-date information.

Engines: duckduckgo (default, no key), brave (needs BRAVE_API_KEY env), tavily (needs TAVILY_API_KEY env), yandex (needs YANDEX_OAUTH_TOKEN env), searxng (public instances).
DuckDuckGo uses honest bot UA with exponential backoff on rate limits (based on ddg-search).
Use "compare" mode to see results from each engine separately without deduplication.`,
    promptSnippet: "Search the web using DuckDuckGo, Brave, Tavily, Yandex, or SearXNG with honest bot User-Agent and exponential backoff retry.",
    promptGuidelines: [
      "Use web_search for finding sources, current information, or web research. Multiple engines can be used with compare mode to cross-check results.",
      "web_search uses exponential backoff with jitter to handle rate limits. Specify engines to use: duckduckgo, brave, tavily, yandex, searxng.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      max_results: Type.Optional(Type.Number({ description: "Max results per engine (default 5)" })),
      engines: Type.Optional(
        Type.Array(
          StringEnum(["duckduckgo", "brave", "tavily", "yandex", "searxng"] as const),
          { description: "Search engines to query (default: ['duckduckgo'])" },
        ),
      ),
      compare: Type.Optional(
        Type.Boolean({ description: "If true, show results per engine without deduplication (default: false)" }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const query = params.query as string;
      const maxResults = (params.max_results as number) ?? 5;
      const engines = (params.engines as SearchEngine[]) ?? ["duckduckgo"];
      const compareMode = (params.compare as boolean) ?? false;

      if (!query || query.trim().length === 0) {
        return {
          content: [{ type: "text", text: "Error: query is required and must not be empty." }],
          details: {},
        };
      }

      const output = await multiEngineWebSearch({
        query,
        maxResults,
        engines,
        compare: compareMode,
        signal,
        onUpdate,
      });

      return {
        content: [{ type: "text", text: output.markdown }],
        details: output.details,
      };
    },
  });

  // === TOOL: scrape_url ===
  pi.registerTool({
    name: "scrape_url",
    label: "Scrape URL",
    description: "Fetch a URL and extract its readable text content. Returns title and cleaned text. Use to get full page content for research.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to scrape" }),
    }),
    async execute(_toolCallId, params) {
      const scraper = new WebScraper();
      const page = await scraper.scrape(params.url);
      return {
        content: [{ type: "text", text: `# ${page.title}\n\n${page.content.substring(0, 5000)}` }],
        details: { page },
      };
    },
  });

  // === TOOL: save_report ===
  pi.registerTool({
    name: "save_report",
    label: "Save Report",
    description: "Save the final research report as a markdown file.",
    parameters: Type.Object({
      topic: Type.String({ description: "Research topic (used in filename)" }),
      markdown: Type.String({ description: "Report content in markdown" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const reportsDir = join(ctx.cwd ?? baseDir, "deep-research", "reports");
      mkdirSync(reportsDir, { recursive: true });

      // Prefer path pre-computed by run_research auto-save (dedup with plan.topic slug)
      const date = new Date().toISOString().slice(0, 10);
      let path: string;
      const entries = ctx.sessionManager.getEntries();
      const reportPathEntry = [...entries].reverse().find((e: any) => e.customType === REPORT_PATH_KEY);
      if (reportPathEntry?.data?.path && typeof reportPathEntry.data.path === "string") {
        path = reportPathEntry.data.path;
      } else {
        const slug = topicToSlug(params.topic);
        const filename = `${date}-${slug}.md`;
        path = join(reportsDir, filename);
      }

      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, params.markdown, "utf-8");

      return {
        content: [{ type: "text", text: `Report saved: ${path}` }],
        details: { report_path: path },
      };
    },
  });

  // === TOOL: plan_research ===
  pi.registerTool({
    name: "plan_research",
    label: "Plan Research",
    description:
      "Three-step research planning. (1) Call with topic — agent proposes engines+profile. (2) Call with topic and params_json — preliminary search runs. (3) Call with topic and plan_json — save plan artifact.",
    parameters: Type.Object({
      topic: Type.Optional(Type.String({ description: "Research topic (optional if plan_json provided, extracted from plan)" })),
      params_json: Type.Optional(Type.String({ description: "JSON with engines and profile (second call)" })),
      plan_json: Type.Optional(Type.String({ description: "JSON research plan (third call)" })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const artifactsDir = join(ctx.cwd ?? baseDir, "deep-research", "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      const scraper = new WebScraper();
      const prefilterRunId = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
      const logsDir = join(artifactsDir, "..", "logs");
      const logger = new JsonlLogger(prefilterRunId, join(logsDir, `${prefilterRunId}-prefilter.log`));

      const manager = new PrefilterManager(searchWeb, scraper, artifactsDir, logger, profileResolver, searchCred);

      // Step 1: topic only → negotiate params
      if (!params.params_json && !params.plan_json) {
        if (!params.topic) {
          return { content: [{ type: "text", text: "Error: topic is required for the first call." }], details: { error: "missing_topic" } };
        }
        const result = await manager.start(params.topic);
        if (result.inject) pi.sendUserMessage(result.inject, { deliverAs: "steer" });
        return {
          content: [{ type: "text", text: `## Research Planning — Phase: ${result.phase}\n\nI've sent you a prompt to choose engines and profile. Respond with JSON, then call plan_research again with params_json.` }],
          details: { phase: result.phase, run_id: result.runId },
        };
      }

      // Step 2: params_json provided → preliminary search
      if (params.params_json && !params.plan_json) {
        if (!params.topic) {
          return { content: [{ type: "text", text: "Error: topic is required when providing params_json." }], details: { error: "missing_topic" } };
        }
        let engines: SearchEngine[];
        let profile: ResearchPlanProfile;
        try {
          const parsed = JSON.parse(params.params_json);
          engines = parsed.engines ?? ["duckduckgo"];
          profile = parsed.profile ?? { name: "default" };
        } catch {
          return { content: [{ type: "text", text: "Error: params_json must be valid JSON." }], details: { error: "invalid_params_json" } };
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
          content: [{ type: "text", text: `## Research Planning — Phase: ${result.phase}\n\nPreliminary search complete. ${result.searchResults?.length ?? 0} results. I've sent a prompt to create the plan.` }],
          details: { phase: result.phase, run_id: result.runId },
        };
      }

      // Step 3: plan_json provided → finalize
      if (params.plan_json) {
        // Extract topic from plan if not passed explicitly
        let topic = params.topic as string;
        if (!topic) {
          try { topic = JSON.parse(params.plan_json).topic || "unknown"; } catch { topic = "unknown"; }
        }
        const result = await manager.finalize(topic, params.plan_json);
        return {
          content: [{ type: "text", text: result.phase === "plan_ready"
            ? `## Research Plan Ready ✅\n\nPlan saved to: ${result.planArtifactPath}\n\n**Topic:** ${result.plan?.topic}\n**Engines:** ${result.plan?.engines.join(", ")}\n**Profile:** ${result.plan?.profile.name}\n**Questions:** ${result.plan?.researchQuestions.length}\n\nNext: show user and ask for confirmation before calling run_research.`
            : `## Plan Error ❌\n\n${result.error}` }],
          details: { phase: result.phase, plan_artifact_path: result.planArtifactPath, plan: result.plan, error: result.error },
        };
      }

      return { content: [{ type: "text", text: "Error: unexpected state." }], details: { error: "unexpected_state" } };
    },
  });

  // === TOOL: estimate_research_cost ===
  pi.registerTool({
    name: "estimate_research_cost",
    label: "Estimate Research Cost",
    description: "Estimate the cost of running a deep research (in API calls). Reads a plan artifact and calculates search/scrape calls based on the profile.",
    parameters: Type.Object({
      plan_artifact_path: Type.String({ description: "Path to the prefilter.json artifact" }),
    }),
    async execute(_toolCallId, params) {
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
  });

  // === TOOL: confirm_research ===
  pi.registerTool({
    name: "confirm_research",
    label: "Confirm Research",
    description: "Confirm a research plan before running. Call after user explicitly approves the plan and cost estimate.",
    parameters: Type.Object({
      plan_artifact_path: Type.String({ description: "Path to the prefilter.json artifact to confirm" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!existsSync(params.plan_artifact_path)) {
        return { content: [{ type: "text", text: `Error: artifact not found at ${params.plan_artifact_path}` }], details: { error: "artifact_not_found" } };
      }
      pi.appendEntry(CONFIRMATION_KEY, { planArtifactPath: params.plan_artifact_path });
      return {
        content: [{ type: "text", text: `## Research Confirmed ✅\n\nPlan: ${params.plan_artifact_path}\n\nReady to run. Call run_research with the plan_artifact_path.` }],
        details: { confirmed: true, plan_artifact_path: params.plan_artifact_path },
      };
    },
  });

  // === TOOL: run_research ===
  // State machine persistence key
  const STATE_KEY = "deep-research:state";
  // Report path key — stored by auto-save, read by save_report for dedup
  const REPORT_PATH_KEY = "deep-research:report-path";
  // Confirmation gate key — stored by confirm_research, checked by run_research
  const CONFIRMATION_KEY = "deep-research:plan-confirmed";

  pi.registerTool({
    name: "run_research",
    label: "Run Research",
    description:
      "Execute the deep research state machine. Call repeatedly until phase='done'. Each call advances the research by one or more phases. On the first call, pass plan_artifact_path. On subsequent calls, pass nothing — the tool manages its own state.",
    parameters: Type.Object({
      plan_artifact_path: Type.Optional(Type.String({ description: "Path to prefilter.json (first call only)" })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      // Load or initialize state
      let snapshot: ResearchSnapshot;

      if (params.plan_artifact_path) {
        if (!existsSync(params.plan_artifact_path)) {
          return {
            content: [{ type: "text", text: `Error: plan artifact not found at ${params.plan_artifact_path}` }],
            details: { error: "artifact_not_found" },
          };
        }

        // Confirmation gate: user must confirm before research runs
        const entries = ctx.sessionManager.getEntries();
        const confirmed = [...entries].reverse().find((e: any) => e.customType === CONFIRMATION_KEY);
        if (!confirmed) {
          return {
            content: [{ type: "text", text: `## Confirmation Required ⚠️\n\nThe research plan must be confirmed by the user before running.\n\n1. Present the plan and cost estimate to the user\n2. Ask for explicit approval\n3. After approval, call confirm_research with the plan path\n4. Then call run_research` }],
            details: { error: "plan_not_confirmed" },
          };
        }
        const confirmedPath = confirmed.data?.planArtifactPath as string | undefined;
        if (confirmedPath && confirmedPath !== params.plan_artifact_path) {
          return {
            content: [{ type: "text", text: `## Plan Mismatch ⚠️\n\nConfirmation is for a different plan (${confirmedPath}). Present this plan to the user and re-confirm.` }],
            details: { error: "plan_mismatch" },
          };
        }
        const raw = readFileSync(params.plan_artifact_path, "utf-8");
        const artifact: PrefilterArtifact = JSON.parse(raw);
        snapshot = ResearchStateMachine.init(artifact.plan, profileResolver.getPresets());

        const scraper = new WebScraper();

        // Compute output directories from plan artifact path (stable across sessions)
        const deepResearchBase = join(dirname(params.plan_artifact_path), "..");
        const artifactsDir = join(deepResearchBase, "artifacts");
        mkdirSync(artifactsDir, { recursive: true });
        const logsDir = join(deepResearchBase, "logs");
        const reportsDir = join(deepResearchBase, "reports");
        mkdirSync(reportsDir, { recursive: true });

        const runLogger = new JsonlLogger(snapshot.runId, join(logsDir, `${snapshot.runId}.log`));
        runLogger.event("run_started", { topic: artifact.plan.topic, profile: artifact.plan.profile, engines: artifact.plan.engines });
        const machine = new ResearchStateMachine(searchWeb, scraper, profileResolver.getPresets(), runLogger, artifactsDir);

        // Advance to first phase (searching → extracting)
        const result = await machine.next(snapshot, artifact.plan);

        // Persist state with base directory for consistent output location
        pi.appendEntry(STATE_KEY, {
          ...result.snapshot,
          plan: artifact.plan,
          planArtifactPath: params.plan_artifact_path,
          deepResearchBase,
        });

        // Inject prompt if any
        if (result.inject) {
          pi.sendUserMessage(result.inject, { deliverAs: "steer" });
        }

        return {
          content: [{ type: "text", text: `## Research Started\n\nPhase: ${result.phase}\nDepth: ${result.snapshot.currentDepth}/${result.snapshot.totalDepth}\nSearch calls: ${result.snapshot.searchCalls}\n\n${result.inject ? "I've sent you a prompt to process. Respond to it, then call run_research again." : "Call run_research again to continue."}` }],
          details: { phase: result.phase, run_id: result.snapshot.runId },
        };
      }

      // Subsequent calls: load state from session
      const entries = ctx.sessionManager.getEntries();
      const lastAssistant = [...entries].reverse().find(
        (e: any) => e.message?.role === "assistant"
      );
      const agentResponse = lastAssistant?.message?.content as string | undefined;
      const lastStateEntry = [...entries].reverse().find((e) => e.customType === STATE_KEY);
      if (!lastStateEntry) {
        return {
          content: [{ type: "text", text: "Error: no research state found. Call run_research with a plan_artifact_path first." }],
          details: { error: "no_state" },
        };
      }

      const stateData = lastStateEntry.data as Record<string, unknown>;
      snapshot = stateData as unknown as ResearchSnapshot;
      const plan = stateData.plan as ResearchPlan;
      const planArtifactPath = stateData.planArtifactPath as string;
      let deepResearchBase = (stateData.deepResearchBase as string) || planArtifactPath ? join(dirname(planArtifactPath), "..") : join(ctx.cwd ?? baseDir, "deep-research");
      // Ensure it's an absolute path
      if (!deepResearchBase.startsWith("/")) deepResearchBase = join(ctx.cwd ?? baseDir, deepResearchBase);
      const logsDir = join(deepResearchBase, "logs");
      const reportsDir = join(deepResearchBase, "reports");
      const artifactsDir = join(deepResearchBase, "artifacts");
      mkdirSync(reportsDir, { recursive: true });

      if (!plan || !snapshot) {
        return {
          content: [{ type: "text", text: "Error: corrupted research state. Start a new research run." }],
          details: { error: "corrupted_state" },
        };
      }

      // Re-create logger for subsequent calls (same file, appends)
      const scraper = new WebScraper();
      const runLogger = new JsonlLogger(snapshot.runId, join(logsDir, `${snapshot.runId}.log`));
      const machine = new ResearchStateMachine(searchWeb, scraper, profileResolver.getPresets(), runLogger, artifactsDir);
      const result = await machine.next(snapshot, plan, agentResponse);

      // Persist updated state
      pi.appendEntry(STATE_KEY, { ...result.snapshot, plan, planArtifactPath, deepResearchBase });

      // Inject prompt if any
      if (result.inject) {
        pi.sendUserMessage(result.inject, { deliverAs: "steer" });
      }

      // If done, save report
      if (result.phase === "done") {
        const reportText = result.snapshot.draftReport ?? "";

        // Guard: log if draftReport is suspiciously short despite passing doSaving validation
        if (reportText.length < 40) {
          runLogger?.event("report_save_warning", {
            reason: "draft_too_short",
            draftLength: reportText.length,
            snapshotPhase: result.snapshot.phase,
          });
        }

        const date = new Date().toISOString().slice(0, 10);
        const slug = topicToSlug(plan.topic);
        const filename = `${date}-${slug}.md`;
        const reportPath = join(reportsDir, filename);

        const { writeFileSync } = await import("node:fs");
        const extensionVersion = readExtensionVersion();
        const telemetry = buildTelemetrySection(result.snapshot, extensionVersion);
        const fullReport = `${reportText}\n\n${telemetry}\n`;
        writeFileSync(reportPath, fullReport, "utf-8");

        // Store path so save_report writes to the same file
        pi.appendEntry(REPORT_PATH_KEY, { path: reportPath });

        runLogger?.event("report_saved", {
          path: reportPath,
          searchCalls: result.snapshot.searchCalls,
          scrapeCalls: result.snapshot.scrapeCalls,
          sourcesVisited: result.snapshot.allVisitedUrls.length,
        });

        return {
          content: [{ type: "text", text: `## Research Complete ✅\n\nReport saved to: ${reportPath}\n\nSearch calls: ${result.snapshot.searchCalls}\nScrape calls: ${result.snapshot.scrapeCalls}\nSources visited: ${result.snapshot.allVisitedUrls.length}` }],
          details: { phase: "done", report_path: reportPath, run_id: result.snapshot.runId },
        };
      }

      return {
        content: [{ type: "text", text: `## Research In Progress\n\nPhase: ${result.phase}\nDepth: ${result.snapshot.currentDepth}/${result.snapshot.totalDepth}\nSearch calls: ${result.snapshot.searchCalls}\nScrape calls: ${result.snapshot.scrapeCalls}\n\n${result.inject ? "I've sent you a prompt. Respond, then call run_research again." : "Call run_research again to continue."}` }],
        details: { phase: result.phase, run_id: result.snapshot.runId },
      };
    },
  });
}
