import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { searchWeb, multiEngineWebSearch } from "./search/web-search.js";
import type { SearchEngine } from "./search/web-search.js";
import { WebScraper } from "./scraper.js";
import { SettingsContext } from "./settings-context.js";
import { ProfileResolver } from "./profile-resolver.js";
import { SessionState } from "./session-state.js";
import { ResearchRunOrchestrator } from "./research-run-orchestrator.js";
import { createRunResearchTool } from "./tools/run-research.js";
import { createPlanResearchTool } from "./tools/plan-research.js";
import { createSaveReportTool } from "./tools/save-report.js";
import type { PrefilterArtifact } from "./prefilter.js";

const baseDir = dirname(fileURLToPath(import.meta.url));

const rootDir = join(baseDir, "..");

export default function (pi: ExtensionAPI) {
  // Load unified settings
  // Use process.cwd() (project dir), not baseDir (extension dir),
  // so default report/artifact paths resolve to ./deep-research/ in the user's project.
  const settings = SettingsContext.init({ cwd: process.cwd() });
  const profileResolver = new ProfileResolver({}, settings.defaultProfile, settings.profiles);
  const reportsDir = settings.reportsDir;
  const artifactsDir = settings.artifactsDir;
  const searchCred = settings.credentials;
  const session = new SessionState({ appendEntry: pi.appendEntry.bind(pi) });

  // Construct orchestrator once — shared across all run_research invocations
  const orchestrator = new ResearchRunOrchestrator({
    searchFn: searchWeb,
    scraper: new WebScraper(),
    profileResolver,
    artifactsDir: settings.artifactsDir,
    searchCred,
    saveState: (snapshot, extra) => session.saveState(snapshot, extra),
  });

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
        credentials: searchCred,
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
  pi.registerTool(createSaveReportTool(settings));

  // === TOOL: plan_research ===
  pi.registerTool(createPlanResearchTool(pi, settings, profileResolver, searchCred));

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
      session.saveConfirmation(params.plan_artifact_path);
      return {
        content: [{ type: "text", text: `## Research Confirmed ✅\n\nPlan: ${params.plan_artifact_path}\n\nReady to run. Call run_research with the plan_artifact_path.` }],
        details: { confirmed: true, plan_artifact_path: params.plan_artifact_path },
      };
    },
  });

  // === TOOL: run_research ===
  pi.registerTool(createRunResearchTool(pi, orchestrator, settings, session));
}
