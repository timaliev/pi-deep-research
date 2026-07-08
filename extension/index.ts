import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { searchWeb } from "./search/web-search.js";
import { WebScraper } from "./scraper.js";
import { SettingsContext } from "./settings-context.js";
import { ProfileResolver } from "./profile-resolver.js";
import { SessionState } from "./session-state.js";
import { ResearchRunOrchestrator } from "./research-run-orchestrator.js";
import { createRunResearchTool } from "./tools/run-research.js";
import { createPlanResearchTool } from "./tools/plan-research.js";
import { createSaveReportTool } from "./tools/save-report.js";
import { createWebSearchTool } from "./tools/web-search.js";
import { createScrapeUrlTool } from "./tools/scrape-url.js";
import { createExportPdfTool } from "./tools/export-pdf.js";
import { createMindMapTool } from "./tools/mind-map.js";
import { createEstimateCostTool } from "./tools/estimate-cost.js";
import { createConfirmPlanTool } from "./tools/confirm-plan.js";

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

  const scraper = new WebScraper();

  // Construct orchestrator once — shared across all run_research invocations
  const orchestrator = new ResearchRunOrchestrator({
    searchFn: searchWeb,
    scraper,
    profileResolver,
    artifactsDir: settings.artifactsDir,
    searchCred,
    saveState: (snapshot, extra) => session.saveState(snapshot, extra),
    settings,
  });

  // Contribute the skill file
  pi.on("resources_discover", () => ({
    skillPaths: [join(baseDir, "..", "skill", "SKILL.md")],
  }));

  // === TOOL: web_search ===
  pi.registerTool(createWebSearchTool(searchCred));

  // === TOOL: scrape_url ===
  pi.registerTool(createScrapeUrlTool(scraper));

  // === TOOL: save_report ===
  pi.registerTool(createSaveReportTool(settings));

  // === TOOL: export_pdf ===
  pi.registerTool(createExportPdfTool(pi.sendUserMessage.bind(pi)));

  // === TOOL: mind_map ===
  pi.registerTool(createMindMapTool(pi.sendUserMessage.bind(pi)));

  // === TOOL: plan_research ===
  pi.registerTool(createPlanResearchTool(pi, settings, profileResolver, searchCred));

  // === TOOL: estimate_research_cost ===
  pi.registerTool(createEstimateCostTool(profileResolver));

  // === TOOL: confirm_research ===
  pi.registerTool(createConfirmPlanTool(session));

  // === TOOL: run_research ===
  pi.registerTool(createRunResearchTool(pi, orchestrator, settings, session));
}
