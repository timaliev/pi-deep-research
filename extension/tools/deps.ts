import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SettingsContext } from "../settings-context.js";
import type { SearchProviderCredentials } from "../settings-context.js";
import type { ProfileResolver } from "../profile-resolver.js";
import type { SessionState } from "../session-state.js";
import type { Scraper } from "../scraper.js";
import type { ResearchRunOrchestrator } from "../research-run-orchestrator.js";
import type { searchWeb } from "../search/web-search.js";
import { createRunResearchTool } from "./run-research.js";
import { createPlanResearchTool } from "./plan-research.js";
import { createSaveReportTool } from "./save-report.js";
import { createWebSearchTool } from "./web-search.js";
import { createScrapeUrlTool } from "./scrape-url.js";
import { createExportPdfTool } from "./export-pdf.js";
import { createMindMapTool } from "./mind-map.js";
import { createEstimateCostTool } from "./estimate-cost.js";
import { createConfirmPlanTool } from "./confirm-plan.js";

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
  pi.registerTool(createExportPdfTool(sendUserMessage));
  pi.registerTool(createMindMapTool(sendUserMessage));
  pi.registerTool(createPlanResearchTool(pi, deps.settings, deps.profileResolver, deps.credentials, deps.scraper, deps.searchFn));
  pi.registerTool(createEstimateCostTool(deps.profileResolver));
  pi.registerTool(createConfirmPlanTool(deps.session));
  pi.registerTool(createRunResearchTool(pi, deps.orchestrator, deps.settings, deps.session));
}
