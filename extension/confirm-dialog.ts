import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResearchPlan } from "./prefilter.js";
import type { ProfileResolver } from "./profile-resolver.js";
import type { SettingsContext } from "./settings-context.js";
import { CONFIRMATION_KEY } from "./session-state.js";

/**
 * Show the research plan confirmation TUI dialog.
 *
 * Idempotent — if the plan is already confirmed (via a prior call or a prior
 * plan_research inline confirmation), returns true immediately without
 * showing the dialog again.
 *
 * In non-interactive mode (!ctx.hasUI), returns false.
 *
 * @returns true if user confirmed (or was already confirmed), false otherwise.
 */
export async function confirmPlanDialog(
  ctx: ExtensionContext,
  plan: ResearchPlan,
  profileResolver: ProfileResolver,
  settings: SettingsContext,
): Promise<boolean> {
  // Already confirmed — skip dialog, avoid double-display
  const entries = ctx.sessionManager.getEntries();
  const alreadyConfirmed = [...entries]
    .reverse()
    .find((e) => (e as Record<string, unknown>).customType === CONFIRMATION_KEY);
  if (alreadyConfirmed) return true;

  if (!ctx.hasUI) return false;

  const style = plan.reportStyle ?? settings.reportStyle ?? "narrative";
  const prof = plan.profile;
  const resolvedProf = profileResolver.resolve(prof);
  const profileDesc =
    prof.name === "custom"
      ? `custom (breadth=${prof.breadth}, depth=${prof.depth}, concurrency=${prof.concurrency})`
      : `${prof.name} (breadth=${resolvedProf.breadth}, depth=${resolvedProf.depth}, concurrency=${resolvedProf.concurrency})`;
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

  return choice?.startsWith("Yes") ?? false;
}
