import { unlinkSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResearchPlan, ResearchPlanProfile } from "./prefilter.js";
import type { ProfileResolver } from "./profile-resolver.js";
import type { SettingsContext } from "./settings-context.js";
import { CONFIRMATION_KEY } from "./session-state.js";

export interface PlanDialogResult {
  /** User clicked Confirm. */
  confirmed: boolean;
  /** User clicked Cancel — plan artifact was deleted. */
  cancelled: boolean;
}

/** Build the plan summary string shared across all dialog levels. */
function buildSummary(plan: ResearchPlan, profileResolver: ProfileResolver, settings: SettingsContext): string {
  const style = plan.reportStyle ?? settings.reportStyle ?? "narrative";
  const prof = plan.profile;
  const resolvedProf = profileResolver.resolve(prof);
  const profileDesc =
    prof.name === "custom"
      ? `custom (breadth=${prof.breadth}, depth=${prof.depth}, concurrency=${prof.concurrency})`
      : `${prof.name} (breadth=${resolvedProf.breadth}, depth=${resolvedProf.depth}, concurrency=${resolvedProf.concurrency})`;
  // ADR-0027: compute cost from actual profile, not agent-written plan field
  const searches = resolvedProf.breadth * resolvedProf.depth * plan.researchQuestions.length;
  const scrapes = Math.ceil(searches * 1.5);
  const costDesc = `~${searches} searches, ~${scrapes} scrapes`;

  return [
    `🔬 Research Plan Confirmation`,
    ``,
    `Topic:      ${plan.topic}`,
    `Engines:    ${plan.engines.join(", ")}`,
    `Profile:    ${profileDesc}`,
    `Style:      ${style}`,
    `Questions:  ${plan.researchQuestions.length}`,
    `Cost:       ${costDesc}`,
  ].join("\n");
}

/**
 * Multi-step TUI confirmation dialog with parameter editing (ADR-0026).
 *
 * Step 1: Confirm / Change parameters / Cancel
 * Step 2: Select parameter to edit (engines, profile, style)
 * Step 3: Edit parameter value
 *
 * Idempotent — returns { confirmed: true } immediately if plan is already confirmed.
 * Non-interactive mode returns { confirmed: false, cancelled: false }.
 */
export async function confirmPlanDialog(
  ctx: ExtensionContext,
  plan: ResearchPlan,
  profileResolver: ProfileResolver,
  settings: SettingsContext,
  planArtifactPath: string,
): Promise<PlanDialogResult> {
  // Already confirmed — skip dialog
  const entries = ctx.sessionManager.getEntries();
  const alreadyConfirmed = [...entries]
    .reverse()
    .find((e) => (e as Record<string, unknown>).customType === CONFIRMATION_KEY);
  if (alreadyConfirmed) return { confirmed: true, cancelled: false };

  if (!ctx.hasUI) return { confirmed: false, cancelled: false };

  // ── Step 1: main menu ──────────────────────────────────────
  while (true) {
    const summary = buildSummary(plan, profileResolver, settings);
    const step1 = await ctx.ui.select(`${summary}\n\nWhat would you like to do?`, [
      "✅ Confirm — Start research",
      "✏️  Change parameters",
      "❌ Cancel — Discard plan",
    ]);

    if (!step1 || step1.startsWith("✅")) {
      return { confirmed: true, cancelled: false };
    }
    if (step1.startsWith("❌")) {
      try {
        unlinkSync(planArtifactPath);
      } catch {
        /* already gone */
      }
      return { confirmed: false, cancelled: true };
    }

    // ── Step 2: parameter selection ───────────────────────────
    while (true) {
      const styleLabel = plan.reportStyle ?? settings.reportStyle ?? "narrative";
      const prof = plan.profile;
      const resolvedProf = profileResolver.resolve(prof);
      const profileLabel =
        prof.name === "custom"
          ? `${prof.name} (${prof.breadth}/${prof.depth}/${prof.concurrency})`
          : `${prof.name} (breadth=${resolvedProf.breadth}, depth=${resolvedProf.depth}, concurrency=${resolvedProf.concurrency})`;

      const param = await ctx.ui.select(`Select parameter to change:`, [
        `Engines: ${plan.engines.join(", ")}`,
        `Profile: ${profileLabel}`,
        `Style: ${styleLabel}`,
        `← Back to main menu`,
      ]);

      if (!param || param.startsWith("←")) break;

      // ── Step 3: edit parameter value ────────────────────────
      if (param.startsWith("Engines")) {
        plan.engines = await editEngines(ctx, plan, settings);
      } else if (param.startsWith("Profile")) {
        plan.profile = await editProfile(ctx, plan, profileResolver);
      } else if (param.startsWith("Style")) {
        plan.reportStyle = await editStyle(ctx, plan.reportStyle ?? settings.reportStyle ?? "narrative");
      }

      // Re-write plan artifact with updated values
      const fs = await import("node:fs/promises");
      const artifact = JSON.parse(await fs.readFile(planArtifactPath, "utf-8"));
      artifact.plan = plan;
      await fs.writeFile(planArtifactPath, JSON.stringify(artifact, null, 2), "utf-8");
    }
  }
}

// ── Step 3 sub-dialogs ────────────────────────────────────

async function editEngines(
  ctx: ExtensionContext,
  plan: ResearchPlan,
  settings: SettingsContext,
): Promise<ResearchPlan["engines"]> {
  const available =
    settings.enabledEngines.length > 0 ? settings.enabledEngines : (plan.enabledEngines ?? plan.engines);
  const selected = new Set(plan.engines);

  // Toggle each engine
  for (const engine of available) {
    const marker = selected.has(engine as SearchEngine) ? "✅" : "⬜";
    const choice = await ctx.ui.select(`Include ${engine}?`, [
      `${marker} Keep ${engine}`,
      `${marker === "✅" ? "⬜" : "✅"} ${marker === "✅" ? "Remove" : "Add"} ${engine}`,
      `✓ Done editing engines`,
    ]);
    if (!choice || choice.startsWith("✓")) break;
    if (choice.includes("Add")) selected.add(engine as SearchEngine);
    else if (choice.includes("Remove")) selected.delete(engine as SearchEngine);
  }

  return selected.size > 0 ? ([...selected] as typeof plan.engines) : [plan.engines[0]];
}

async function editProfile(
  ctx: ExtensionContext,
  _plan: ResearchPlan,
  profileResolver: ProfileResolver,
): Promise<ResearchPlanProfile> {
  const presets = profileResolver.listNames();
  const choices = [...presets, "custom", "← Back"];

  const choice = await ctx.ui.select(
    "Select profile:",
    choices.map((c) => (c === "← Back" ? c : `Profile: ${c}`)),
  );
  if (!choice || choice.includes("← Back")) return _plan.profile;

  const name = choice.replace("Profile: ", "") as ResearchPlanProfile["name"];

  if (name === "custom") {
    const breadthStr = await ctx.ui.input("Custom breadth (search queries per question):", String(4));
    const depthStr = await ctx.ui.input("Custom depth (recursion levels):", String(2));
    const concurrencyStr = await ctx.ui.input("Custom concurrency (parallel searches):", String(4));
    return {
      name: "custom",
      breadth: parseInt(breadthStr ?? "4", 10) || 4,
      depth: parseInt(depthStr ?? "2", 10) || 2,
      concurrency: parseInt(concurrencyStr ?? "4", 10) || 4,
    };
  }

  return { name };
}

async function editStyle(ctx: ExtensionContext, current: string): Promise<"narrative" | "subtopics"> {
  const choice = await ctx.ui.select(`Current style: ${current}`, [
    `narrative${current === "narrative" ? " ← current" : ""}`,
    `subtopics${current === "subtopics" ? " ← current" : ""}`,
    "← Back",
  ]);
  if (!choice || choice.startsWith("←")) return current as "narrative" | "subtopics";
  return choice.startsWith("narrative") ? "narrative" : "subtopics";
}
