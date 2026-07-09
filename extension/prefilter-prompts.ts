/**
 * Prompt builders for the prefilter (plan_research) workflow.
 *
 * Pure functions — no state, no side effects.
 * Extracted from PrefilterManager to enable isolated testing and iteration.
 */
import type { SearchEngine } from "../search/web-search.js";
import type { WebSearchResult } from "../search/web-search.js";
import type { ScrapedPage } from "../scraper.js";
import type { SearchProviderCredentials } from "../settings-context.js";

/** Build the seed search query from a topic string. */
export function buildSearchQuery(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").substring(0, 300);
}

/** Build engine availability status (✅/❌ per engine). */
export function buildEngineStatus(cred?: SearchProviderCredentials): string {
  const engines: Array<{ name: string; key: string; available: boolean }> = [
    { name: "duckduckgo", key: "none", available: true },
    { name: "brave", key: "BRAVE_API_KEY", available: cred?.get("brave", "apiKey") != null },
    { name: "tavily", key: "TAVILY_API_KEY", available: cred?.get("tavily", "apiKey") != null },
    { name: "yandex", key: "YANDEX_OAUTH_TOKEN", available: cred?.get("yandex", "oauthToken") != null },
    { name: "searxng", key: "none", available: true },
  ];
  return engines
    .map((e) => `  ${e.available ? "✅" : "❌"} ${e.name}${e.key !== "none" ? ` (needs ${e.key})` : ""}`)
    .join("\n");
}

/** Build warning when API keys are missing for selected engines. */
export function buildApiKeyWarning(missing: string[]): string {
  return `## API Key Required\n\nMissing: ${missing.join(", ")}. Set env vars and retry, or switch to duckduckgo.`;
}

/** Build the first prompt: choose engines + profile + report style. */
export function buildParamsPrompt(
  topic: string,
  presets: Record<string, { breadth: number; depth: number; concurrency: number }>,
  defaultProfileName: string,
  engineStatus: string,
  defaultReportStyle?: "narrative" | "subtopics",
): string {
  const presetsList = Object.entries(presets)
    .map(([name, p]) => `  ${name}: breadth=${p.breadth}, depth=${p.depth}, concurrency=${p.concurrency}`)
    .join("\n");

  const style = defaultReportStyle ?? "narrative";
  const narrativeLabel = style === "narrative" ? " (default)" : "";
  const subtopicsLabel = style === "subtopics" ? " (default)" : "";

  return `## Research Parameters\n\nTopic: ${topic}\n\nChoose search engines, profile, and report style. Reply with JSON:\n\`\`\`json\n{"engines":["duckduckgo"],"profile":{"name":"${defaultProfileName}"},"reportStyle":"${style}"}\n\`\`\`\n\nEngine availability:\n${engineStatus}\n\nAvailable profiles (default: **${defaultProfileName}**):\n${presetsList}\n  custom: specify breadth, depth, concurrency\n\nReport styles:\n  narrative${narrativeLabel} — fixed 5-section template (Introduction/Findings/Analysis/Recommendations/Sources)\n  subtopics${subtopicsLabel} — LLM discovers 5–10 thematic sections from findings\n\nYou may change the profile or report style later during plan creation.`;
}

/** Build the second prompt: produce a full Research Plan JSON. */
export function buildPlanPrompt(
  topic: string,
  engines: SearchEngine[],
  profileName: string,
  resolvedBreadth: number,
  resolvedDepth: number,
  resolvedConcurrency: number,
  presets: Record<string, { breadth: number; depth: number; concurrency: number }>,
  searchResults: WebSearchResult[],
  scrapedContent: ScrapedPage[],
): string {
  const profileList = Object.entries(presets)
    .map(([name, p]) => `  ${name}: breadth=${p.breadth}, depth=${p.depth}, concurrency=${p.concurrency}`)
    .join("\n");

  let p = `## Research Planning\n\nTopic: ${topic}\nEngines: [${engines.join(", ")}]\nProfile: ${profileName} (breadth=${resolvedBreadth}, depth=${resolvedDepth}, concurrency=${resolvedConcurrency})\n\nYou may change the profile in the plan JSON. Available profiles:\n${profileList}\n  custom: specify breadth, depth, concurrency\n\nPick the profile that best fits this research.\n\n### Preliminary Search\n\n`;
  for (const r of searchResults) p += `- [${r.title}](${r.url}): ${r.snippet}\n`;
  if (scrapedContent.length > 0) {
    p += `\n### Scraped Content\n\n`;
    for (const sp of scrapedContent) p += `**${sp.title}** (${sp.url})\n\n${sp.content.substring(0, 800)}\n\n---\n`;
  }
  p += `\n### Instructions\n\nProduce research plan JSON:
\`\`\`json\n{"topic":"${topic}","goal":"...","researchQuestions":["Q1"],"engines":${JSON.stringify(engines)},"profile":{"name":"${profileName}"},"scope":{"include":"...","exclude":"..."},"estimatedCost":{"searchCalls":12,"scrapeCalls":8,"description":"~12 searches"}}\n\`\`\`\n\nSet reportStyle to "narrative" (fixed 5-section) or "subtopics" (LLM discovers thematic sections). Output ONLY JSON.`;
  return p;
}
