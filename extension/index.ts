import { Type } from "typebox";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { DuckDuckGoProvider } from "./search/duckduckgo.js";
import { TavilyProvider } from "./search/tavily.js";
import { BraveProvider } from "./search/brave.js";
import { WebScraper } from "./scraper.js";
import type { SearchProvider } from "./search/provider.js";
import { PrefilterManager } from "./prefilter.js";
import { ResearchStateMachine, buildTelemetrySection } from "./state-machine.js";
import type { ResearchPlan, PrefilterArtifact, PrefilterResult } from "./prefilter.js";
import type { ResearchSnapshot } from "./state-machine.js";
import type { ResearchProfile } from "./state-machine.js";

const baseDir = dirname(fileURLToPath(import.meta.url));

interface DeepResearchSettings {
  searchProvider?: "duckduckgo" | "tavily" | "brave";
  profiles?: Record<string, ResearchProfile>;
  artifactsDir?: string;
  reportsDir?: string;
}

const DEFAULT_PROFILE: ResearchProfile = { breadth: 4, depth: 2, concurrency: 4 };
const DEFAULT_SETTINGS: DeepResearchSettings = {
  searchProvider: "duckduckgo",
  profiles: {
    default: DEFAULT_PROFILE,
    fast: { breadth: 2, depth: 1, concurrency: 2 },
    deep: { breadth: 6, depth: 3, concurrency: 4 },
  },
};

function createSearchProvider(settings: DeepResearchSettings): SearchProvider {
  const provider = settings.searchProvider ?? "duckduckgo";
  switch (provider) {
    case "tavily": {
      const key = process.env.TAVILY_API_KEY;
      if (!key) throw new Error("TAVILY_API_KEY not set. Configure it in your environment or switch to duckduckgo.");
      return new TavilyProvider(key);
    }
    case "brave": {
      const key = process.env.BRAVE_API_KEY;
      if (!key) throw new Error("BRAVE_API_KEY not set. Configure it in your environment or switch to duckduckgo.");
      return new BraveProvider(key);
    }
    default:
      return new DuckDuckGoProvider();
  }
}

function resolveSettings(settings: Record<string, unknown> = {}): DeepResearchSettings {
  const dr = (settings.deepResearch ?? {}) as Record<string, unknown>;
  return {
    searchProvider: (dr.searchProvider as string) ?? DEFAULT_SETTINGS.searchProvider,
    profiles: (dr.profiles as Record<string, ResearchProfile>) ?? DEFAULT_SETTINGS.profiles,
    artifactsDir: (dr.artifactsDir as string) ?? join(baseDir, "..", "..", "deep-research", "artifacts"),
    reportsDir: (dr.reportsDir as string) ?? join(baseDir, "..", "..", "deep-research", "reports"),
  };
}

export default function (pi: ExtensionAPI) {
  // Contribute the skill file
  pi.on("resources_discover", () => ({
    skillPaths: [join(baseDir, "..", "..", "skill", "SKILL.md")],
  }));

  // === TOOL: web_search ===
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web using DuckDuckGo. Returns results with title, URL, and snippet. Use for finding sources during deep research.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      max_results: Type.Optional(Type.Number({ description: "Max results (default 5)" })),
    }),
    async execute(_toolCallId, params) {
      const settings = resolveSettings();
      const provider = createSearchProvider(settings);
      const results = await provider.search(params.query, params.max_results ?? 5);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        details: { results },
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
    async execute(_toolCallId, params) {
      const reportsDir = join(baseDir, "..", "..", "deep-research", "reports");
      mkdirSync(reportsDir, { recursive: true });

      const date = new Date().toISOString().slice(0, 10);
      const slug = params.topic
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 80);
      const filename = `${date}-${slug}.md`;
      const path = join(reportsDir, filename);

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
      "Start the research planning phase. Call once with topic to get preliminary search results and a prompt. Call again with the same topic and your JSON research plan to save it. Two-step: (1) plan_research({topic}), then (2) plan_research({topic, plan_json}).",
    parameters: Type.Object({
      topic: Type.String({ description: "Research topic" }),
      plan_json: Type.Optional(Type.String({ description: "JSON research plan (on second call)" })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const settings = resolveSettings({});
      const artifactsDir = join(ctx.cwd ?? baseDir, "deep-research", "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      const searchProvider = createSearchProvider(settings);
      const scraper = new WebScraper();
      const manager = new PrefilterManager(searchProvider, scraper, artifactsDir);

      if (!params.plan_json) {
        // First call: preliminary search
        const result = await manager.start(params.topic);

        // Inject the plan prompt into the conversation
        if (result.inject) {
          pi.sendUserMessage(result.inject, { deliverAs: "steer" });
        }

        return {
          content: [
            {
              type: "text",
              text: `## Research Planning — Phase: ${result.phase}\n\nPreliminary search complete. ${result.searchResults?.length ?? 0} results found, ${result.scrapedContent?.length ?? 0} pages scraped. I've sent you a prompt to create the research plan.\n\n**Next:** Respond with a JSON research plan, then call plan_research again with your plan in the plan_json parameter.`,
            },
          ],
          details: { phase: result.phase, run_id: result.runId },
        };
      }

      // Second call: finalize the plan
      const result = await manager.finalize(params.topic, params.plan_json);
      return {
        content: [
          {
            type: "text",
            text:
              result.phase === "plan_ready"
                ? `## Research Plan Ready ✅\n\nPlan saved to: ${result.planArtifactPath}\n\n**Topic:** ${result.plan?.topic}\n**Goal:** ${result.plan?.goal}\n**Questions:** ${result.plan?.researchQuestions.length}\n**Estimated cost:** ${result.plan?.estimatedCost?.description}\n\nNext: show this to the user and ask for confirmation before calling run_research.`
                : `## Plan Error ❌\n\n${result.error}\n\nPlease fix the JSON and try again.`,
          },
        ],
        details: {
          phase: result.phase,
          plan_artifact_path: result.planArtifactPath,
          plan: result.plan,
          error: result.error,
        },
      };
    },
  });

  // === TOOL: estimate_research_cost ===
  pi.registerTool({
    name: "estimate_research_cost",
    label: "Estimate Research Cost",
    description: "Estimate the cost of running a deep research (in API calls). Reads a plan artifact and calculates search/scrape calls based on the profile.",
    parameters: Type.Object({
      plan_artifact_path: Type.String({ description: "Path to the prefilter.json artifact" }),
      profile: Type.Optional(Type.String({ description: "Profile name: default, fast, or deep" })),
    }),
    async execute(_toolCallId, params) {
      if (!existsSync(params.plan_artifact_path)) {
        return {
          content: [{ type: "text", text: `Error: artifact not found at ${params.plan_artifact_path}` }],
          details: { error: "artifact_not_found" },
        };
      }

      const raw = readFileSync(params.plan_artifact_path, "utf-8");
      const artifact: PrefilterArtifact = JSON.parse(raw);
      const settings = resolveSettings();
      const profile = settings.profiles?.[params.profile ?? "default"] ?? DEFAULT_PROFILE;

      const estSearches = profile.breadth * profile.depth * artifact.plan.researchQuestions.length;
      const estScrapes = estSearches * 2;

      return {
        content: [
          {
            type: "text",
            text: [
              `## Research Cost Estimate`,
              ``,
              `**Profile:** ${params.profile ?? "default"} (breadth=${profile.breadth}, depth=${profile.depth})`,
              `**Research questions:** ${artifact.plan.researchQuestions.length}`,
              `**Estimated searches:** ~${estSearches}`,
              `**Estimated scrapes:** ~${estScrapes}`,
              ``,
              `**Search provider:** ${settings.searchProvider ?? "duckduckgo"}`,
              `DuckDuckGo: free (no API key needed)`,
              `Tavily: ~$0.01 per search (requires API key)`,
            ].join("\n"),
          },
        ],
        details: { estimated_searches: estSearches, estimated_scrapes: estScrapes, profile },
      };
    },
  });

  // === TOOL: run_research ===
  // State machine persistence key
  const STATE_KEY = "deep-research:state";

  pi.registerTool({
    name: "run_research",
    label: "Run Research",
    description:
      "Execute the deep research state machine. Call repeatedly until phase='done'. Each call advances the research by one or more phases. On the first call, pass plan_artifact_path. On subsequent calls, pass nothing — the tool manages its own state.",
    parameters: Type.Object({
      plan_artifact_path: Type.Optional(Type.String({ description: "Path to prefilter.json (first call only)" })),
      profile: Type.Optional(Type.String({ description: "Profile name: default, fast, or deep" })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const settings = resolveSettings();
      const artifactsDir = join(ctx.cwd ?? baseDir, "deep-research", "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      const searchProvider = createSearchProvider(settings);
      const scraper = new WebScraper();

      // Load or initialize state
      let snapshot: ResearchSnapshot;

      if (params.plan_artifact_path) {
        if (!existsSync(params.plan_artifact_path)) {
          return {
            content: [{ type: "text", text: `Error: plan artifact not found at ${params.plan_artifact_path}` }],
            details: { error: "artifact_not_found" },
          };
        }
        const raw = readFileSync(params.plan_artifact_path, "utf-8");
        const artifact: PrefilterArtifact = JSON.parse(raw);
        const profile = settings.profiles?.[params.profile ?? "default"] ?? DEFAULT_PROFILE;
        const machine = new ResearchStateMachine(searchProvider, scraper, profile);
        snapshot = ResearchStateMachine.init(artifact.plan, profile);

        // Advance to first phase (searching → extracting)
        const result = await machine.next(snapshot, artifact.plan);

        // Persist state
        pi.appendEntry(STATE_KEY, { ...result.snapshot, plan: artifact.plan, profile, planArtifactPath: params.plan_artifact_path });

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
      const lastStateEntry = [...entries].reverse().find((e) => e.customType === STATE_KEY);
      if (!lastStateEntry) {
        return {
          content: [{ type: "text", text: "Error: no research state found. Call run_research with a plan_artifact_path first." }],
          details: { error: "no_state" },
        };
      }

      const stateData = lastStateEntry.content as Record<string, unknown>;
      snapshot = stateData as unknown as ResearchSnapshot;
      const plan = stateData.plan as ResearchPlan;
      const profile = (stateData.profile ?? DEFAULT_PROFILE) as ResearchProfile;
      const planArtifactPath = stateData.planArtifactPath as string;

      if (!plan || !snapshot) {
        return {
          content: [{ type: "text", text: "Error: corrupted research state. Start a new research run." }],
          details: { error: "corrupted_state" },
        };
      }

      const machine = new ResearchStateMachine(searchProvider, scraper, profile);
      const result = await machine.next(snapshot, plan);

      // Persist updated state
      pi.appendEntry(STATE_KEY, { ...result.snapshot, plan, profile, planArtifactPath });

      // Inject prompt if any
      if (result.inject) {
        pi.sendUserMessage(result.inject, { deliverAs: "steer" });
      }

      // If done, save report
      if (result.phase === "done") {
        // Read the last assistant message as the report
        const lastAssistant = [...entries].reverse().find(
          (e) => e.type === "assistant" || e.role === "assistant"
        );
        const reportText = lastAssistant?.content ?? "";

        const reportsDir = join(ctx.cwd ?? baseDir, "deep-research", "reports");
        mkdirSync(reportsDir, { recursive: true });
        const date = new Date().toISOString().slice(0, 10);
        const slug = plan.topic.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
        const filename = `${date}-${slug}.md`;
        const reportPath = join(reportsDir, filename);

        const { writeFileSync } = await import("node:fs");
        const telemetry = buildTelemetrySection(result.snapshot);
        const fullReport = `${typeof reportText === "string" ? reportText : ""}\n\n${telemetry}\n`;
        writeFileSync(reportPath, fullReport, "utf-8");

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
