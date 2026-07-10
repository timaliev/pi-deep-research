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
import { readPlanArtifact } from "./tools/shared.js";

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

  // Release monitor + settings report + settings re-init on session start (ADR-0018, ADR-0020, ADR-0023)
  pi.on("session_start", (_event: any, ctx: any) => {
    settings.reinit(ctx.cwd);
    checkForNewRelease(pi.sendUserMessage.bind(pi));

    // Always log settings on session start
    const logsDir = join(settings.artifactsDir, "..", "logs");
    mkdirSync(logsDir, { recursive: true });
    writeSettingsLog(settings, logsDir, { trigger: "session_start" });

    // Inject settings table if onSessionStart is enabled
    if (settings.settingsReport.onSessionStart) {
      const table = buildSettingsTable(settings);
      pi.sendUserMessage(`## Deep Research Settings\n\n${table}`, { deliverAs: "steer" });
    }
  });

  // TUI confirmation gate — enforce user approval before research runs (ADR-0019)
  pi.on("tool_call", async (event: any, ctx: any) => {
    if (event.toolName !== "confirm_research") return;

    const planPath = event.input?.plan_artifact_path;
    const artifact = readPlanArtifact(planPath);
    if (!artifact.ok) {
      return { block: true, reason: `Cannot read plan: ${artifact.error}` };
    }

    const plan = artifact.artifact.plan;
    const style = plan.reportStyle ?? settings.reportStyle ?? "narrative";
    const prof = plan.profile;
    const profileDesc =
      prof.name === "custom"
        ? `custom (breadth=${prof.breadth}, depth=${prof.depth}, concurrency=${prof.concurrency})`
        : `${prof.name} (breadth=${profileResolver.resolve(prof).breadth}, depth=${profileResolver.resolve(prof).depth}, concurrency=${profileResolver.resolve(prof).concurrency})`;

    if (!ctx.hasUI) {
      return { block: true, reason: "Confirmation requires interactive mode." };
    }

    const cost = plan.estimatedCost;
    const costDesc = cost?.description ?? `${cost?.searchCalls ?? "?"} searches, ${cost?.scrapeCalls ?? "?"} scrapes`;

    const choice = await ctx.ui.select(
      [
        `🔬 Research Plan Confirmation`,
        ``,
        `Topic:      ${plan.topic}`,
        `Engines:    ${plan.engines.join(", ")}`,
        `Profile:    ${profileDesc}`,
        `Style:      ${style}`,
        `Questions:  ${plan.researchQuestions.length}`,
        `Cost:       ${costDesc}`,
        ``,
        `Start deep research?`,
      ].join("\n"),
      ["No — Review plan", "Yes — Start research"],
    );

    if (!choice || !choice.startsWith("Yes")) {
      return { block: true, reason: "Confirmation declined by user" };
    }
  });
}
