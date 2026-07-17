import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProfileResolver } from "../profile-resolver.js";
import type { ResearchRunOrchestrator } from "../research-run-orchestrator.js";
import type { Scraper } from "../scraper.js";
import type { searchWeb } from "../search/web-search.js";
import type { SessionState } from "../session-state.js";
import type { SearchProviderCredentials, SettingsContext } from "../settings-context.js";
import { createExportPdfTool } from "./export-pdf.js";
import { createMindMapTool } from "./mind-map.js";
import { createPlanResearchTool } from "./plan-research.js";
import { createRunResearchTool } from "./run-research.js";
import { createSaveReportTool } from "./save-report.js";
import { createScrapeUrlTool } from "./scrape-url.js";
import { createWebSearchTool } from "./web-search.js";

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

/** Register all deep-research tools. Single call replaces 9 inline pi.registerTool() calls. */
export function registerAllTools(pi: ExtensionAPI, deps: ToolDeps): void {
  const sendUserMessage = pi.sendUserMessage.bind(pi);

  pi.registerTool(createWebSearchTool(deps.credentials));
  pi.registerTool(createScrapeUrlTool(deps.scraper));
  pi.registerTool(createSaveReportTool(deps.settings));
  pi.registerTool(createExportPdfTool(sendUserMessage, deps.settings));
  pi.registerTool(createMindMapTool(sendUserMessage, deps.settings));
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
  pi.registerTool(createRunResearchTool(pi, deps.orchestrator, deps.settings, deps.session));
}
