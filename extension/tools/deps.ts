import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { convertToPdf } from "../export-pdf.js";
import { buildMindMapPrompt } from "../mind-map-injector.js";
import type { ProfileResolver } from "../profile-resolver.js";
import { resolveReportPath, writeReportFile } from "../report-assembly.js";
import type { ResearchRunOrchestrator } from "../research-run-orchestrator.js";
import type { Scraper, WebScraper } from "../scraper.js";
import { ALL_ENGINES, type SearchEngine } from "../search/engines.js";
import type { searchWeb } from "../search/web-search.js";
import { multiEngineWebSearch } from "../search/web-search.js";
import type { SessionState } from "../session-state.js";
import { REPORT_PATH_KEY } from "../session-state.js";
import type { SearchProviderCredentials, SettingsContext } from "../settings-context.js";
import { createPlanResearchTool } from "./plan-research.js";
import { createRunResearchTool } from "./run-research.js";

/** Bundled dependencies shared across all tool factories. */
export interface ToolDeps {
  settings: SettingsContext;
  profileResolver: ProfileResolver;
  credentials: SearchProviderCredentials;
  session: SessionState;
  scraper: Scraper;
  orchestrator: ResearchRunOrchestrator;
  searchFn: typeof searchWeb;
}

/** Register all deep-research tools. */
export function registerAllTools(pi: ExtensionAPI, deps: ToolDeps): void {
  const sendUserMessage = pi.sendUserMessage.bind(pi);

  // deep_web_search
  pi.registerTool({
    name: "deep_web_search",
    label: "Web Search",
    description:
      "Search the web via DuckDuckGo, Brave, Tavily, Yandex, or SearXNG with exponential backoff retry. Use compare mode to cross-check results across engines.",
    promptSnippet:
      "Search the web using DuckDuckGo, Brave, Tavily, Yandex, or SearXNG with honest bot User-Agent and exponential backoff retry.",
    promptGuidelines: [
      "Use deep_web_search for finding sources, current information, or web research. Multiple engines can be used with compare mode to cross-check results.",
      "deep_web_search uses exponential backoff with jitter to handle rate limits. Specify engines to use: duckduckgo, brave, tavily, yandex, searxng.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      max_results: Type.Optional(Type.Number({ description: "Max results per engine (default 5)" })),
      engines: Type.Optional(
        Type.Array(StringEnum(ALL_ENGINES), { description: "Search engines to query (default: ['duckduckgo'])" }),
      ),
      compare: Type.Optional(
        Type.Boolean({ description: "If true, show results per engine without deduplication (default: false)" }),
      ),
    }),
    async execute(_toolCallId: string, params: Record<string, unknown>, signal: any, onUpdate: unknown) {
      const query = params.query as string;
      const maxResults = (params.max_results as number) ?? 5;
      const engines = (params.engines as SearchEngine[]) ?? ["duckduckgo"];
      const compareMode = (params.compare as boolean) ?? false;
      if (!query || query.trim().length === 0) {
        return { content: [{ type: "text", text: "Error: query is required and must not be empty." }], details: {} };
      }
      const output = await multiEngineWebSearch({
        query,
        maxResults,
        engines,
        compare: compareMode,
        signal,
        credentials: deps.credentials,
        onUpdate,
      });
      return { content: [{ type: "text", text: output.markdown }], details: output.details };
    },
  });

  // scrape_url
  pi.registerTool({
    name: "scrape_url",
    label: "Scrape URL",
    description:
      "Fetch a URL and extract its readable text content. Returns title and cleaned text. Use to get full page content for research.",
    parameters: Type.Object({ url: Type.String({ description: "URL to scrape" }) }),
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const page = await (deps.scraper as WebScraper).scrape(params.url);
      return {
        content: [{ type: "text", text: `# ${page.title}\n\n${page.content.substring(0, 5000)}` }],
        details: { page },
      };
    },
  });

  // save_report
  pi.registerTool({
    name: "save_report",
    label: "Save Report",
    description: "Save the final research report as a markdown file.",
    parameters: Type.Object({
      topic: Type.String({ description: "Research topic (used in filename)" }),
      markdown: Type.Optional(Type.String({ description: "Report content in markdown" })),
      report_path: Type.Optional(
        Type.String({
          description:
            "Path to an existing report file to re-save (for large reports that can't be passed as markdown)",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: Record<string, unknown>,
    ) {
      mkdirSync(deps.settings.reportsDir, { recursive: true });
      let markdown: string;
      if (params.report_path && typeof params.report_path === "string" && existsSync(params.report_path)) {
        markdown = readFileSync(params.report_path, "utf-8");
      } else if (params.markdown && typeof params.markdown === "string") {
        markdown = params.markdown;
      } else {
        return {
          content: [{ type: "text", text: "Error: either markdown or report_path must be provided." }],
          details: { error: "missing_content" },
        };
      }
      const entries = ctx.sessionManager.getEntries();
      const reportPathEntry = [...entries].reverse().find((e: any) => e.customType === REPORT_PATH_KEY);
      const storedRunId = (reportPathEntry?.data as any)?.runId as string | undefined;
      const storedPath = reportPathEntry?.data?.path as string | undefined;
      let path: string;
      if (storedPath && typeof storedPath === "string" && storedRunId) {
        const expectedPath = resolveReportPath(params.topic, deps.settings.reportsDir, storedRunId);
        path = storedPath === expectedPath ? storedPath : resolveReportPath(params.topic, deps.settings.reportsDir);
      } else if (storedPath && typeof storedPath === "string") {
        path = storedPath;
      } else {
        path = resolveReportPath(params.topic, deps.settings.reportsDir);
      }
      writeReportFile(path, markdown);
      return { content: [{ type: "text", text: `Report saved: ${path}` }], details: { report_path: path } };
    },
  });

  // export_pdf
  pi.registerTool({
    name: "export_pdf",
    label: "Export PDF",
    description:
      "Export a research report as PDF using pandoc+weasyprint. Falls back to agent-based conversion if pandoc not installed.",
    parameters: Type.Object({
      report_path: Type.String({ description: "Path to the markdown report file" }),
      output_path: Type.Optional(Type.String({ description: "Output PDF path (defaults to same name + .pdf)" })),
    }),
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const reportPath = params.report_path as string;
      const outputPath =
        (params.output_path as string | undefined) ??
        join(deps.settings.reportsDir, basename(reportPath).replace(/\.md$/, "") + ".pdf");
      const result = await convertToPdf({ reportPath, outputPath });
      if (result.kind === "error") {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], details: { error: result.error } };
      }
      if (result.kind === "success") {
        return {
          content: [{ type: "text", text: `PDF exported (pandoc): ${result.outputPath}` }],
          details: { pdf_path: result.outputPath, method: result.method },
        };
      }
      sendUserMessage(
        `## PDF Export — Agent Fallback\n\n${result.error}\n\nConvert the report to PDF using available tools:\n- Report: ${reportPath}\n- Output: ${result.outputPath}\n\nUse print-to-PDF in browser, or any other available PDF tool.`,
        { deliverAs: "steer" },
      );
      return {
        content: [
          {
            type: "text",
            text: `${result.error} Prompt sent for agent-based conversion. Output: ${result.outputPath}`,
          },
        ],
        details: { fallback: true, missing_tools: result.error, pdf_path: result.outputPath },
      };
    },
  });

  // mind_map
  pi.registerTool({
    name: "mind_map",
    label: "Generate Mind Map",
    description:
      "Generate a Mermaid mind map (graph TD) from research findings or any text content. The agent responds with a Mermaid diagram block. Use save_path to persist to a file.",
    parameters: Type.Object({
      topic: Type.String({ description: "Topic for the mind map" }),
      content: Type.String({ description: "Content to base the mind map on (findings, notes, report text)" }),
      save_path: Type.Optional(Type.String({ description: "Optional file path to save the mind map diagram" })),
    }),
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const savePath = (params.save_path as string | undefined) ?? undefined;
      const prompt = buildMindMapPrompt(
        params.topic as string,
        undefined,
        params.content as string,
        savePath ??
          join(deps.settings.reportsDir, `${(params.topic as string).replace(/\s+/g, "-").toLowerCase()}.mmd`),
      );
      sendUserMessage(prompt, { deliverAs: "steer" });
      return {
        content: [
          {
            type: "text",
            text: `Mind map prompt sent. Respond with a Mermaid \`graph TD\` block for topic: ${params.topic}.${params.save_path ? ` Save to: ${params.save_path}` : ""}`,
          },
        ],
        details: { topic: params.topic, save_path: params.save_path },
      };
    },
  });

  // plan_research (deep module, stays in own file)
  pi.registerTool(
    createPlanResearchTool(
      pi,
      deps.settings,
      deps.profileResolver,
      deps.credentials,
      deps.session,
      deps.scraper,
      deps.searchFn,
    ),
  );

  // run_research (deep module, stays in own file)
  pi.registerTool(createRunResearchTool(pi, deps.orchestrator, deps.settings, deps.session));
}
