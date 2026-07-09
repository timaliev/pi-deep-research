import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { searchWeb } from "./search/web-search.js";
import { WebScraper } from "./scraper.js";
import { SettingsContext } from "./settings-context.js";
import { ProfileResolver } from "./profile-resolver.js";
import { SessionState } from "./session-state.js";
import { ResearchRunOrchestrator } from "./research-run-orchestrator.js";
import { registerAllTools } from "./tools/deps.js";

const baseDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(baseDir, "..");

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
}
