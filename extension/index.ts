import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProfileResolver } from "./profile-resolver.js";
import { checkForNewRelease } from "./release-monitor.js";
import { ResearchRunOrchestrator } from "./research-run-orchestrator.js";
import { WebScraper } from "./scraper.js";
import { searchWeb } from "./search/web-search.js";
import { SessionState } from "./session-state.js";
import { SettingsContext } from "./settings-context.js";
import { buildSettingsTable, writeSettingsLog } from "./settings-reporter.js";
import { registerAllTools } from "./tools/deps.js";

const baseDir = dirname(fileURLToPath(import.meta.url));
const _rootDir = join(baseDir, "..");

export default function (pi: ExtensionAPI) {
  const settings = SettingsContext.init({ cwd: process.cwd() });
  const profileResolver = new ProfileResolver({}, settings.defaultProfile, settings.profiles);
  const session = new SessionState({ appendEntry: pi.appendEntry.bind(pi) });
  const scraper = new WebScraper();

  const orchestrator = new ResearchRunOrchestrator({
    searchFn: searchWeb,
    scraper,
    profileResolver,
    artifactsDir: settings.artifactsDir,
    searchCred: settings.credentials,
    saveState: (snapshot, extra) => session.saveState(snapshot, extra),
    settings,
  });

  // Contribute the skill file
  pi.on("resources_discover", () => ({
    skillPaths: [join(baseDir, "..", "skill", "SKILL.md")],
  }));

  // Register all tools via single injection point
  registerAllTools(pi, {
    settings,
    profileResolver,
    credentials: settings.credentials,
    session,
    scraper,
    orchestrator,
    searchFn: searchWeb,
  });

  // Release monitor + settings report + settings re-init on session start (ADR-0018, ADR-0020, ADR-0023)
  pi.on("session_start", (_event: Record<string, unknown>, ctx: { cwd: string }) => {
    settings.reinit(ctx.cwd);
    checkForNewRelease(pi.sendUserMessage.bind(pi));

    // Always log settings on session start
    const logsDir = join(settings.artifactsDir, "..", "logs");
    mkdirSync(logsDir, { recursive: true });
    writeSettingsLog(settings, logsDir, { trigger: "session_start" });

    // Inject settings table if onSessionStart is enabled
    if (settings.settingsReport.onSessionStart) {
      const table = buildSettingsTable(settings);
      pi.sendUserMessage(`## ℹ️ Deep Research Settings (informational — not a research request)\n\n${table}`, {
        deliverAs: "steer",
      });
    }
  });
}
