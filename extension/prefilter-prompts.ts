/**
 * Prompt builders for the prefilter (plan_research) workflow.
 *
 * Pure functions — no state, no side effects.
 * Extracted from PrefilterManager to enable isolated testing and iteration.
 */

import type { ScrapedPage } from "../scraper.js";
import { ALL_ENGINES, ENGINE_META, type SearchEngine } from "./search/engines.js";
import type { WebSearchResult } from "../search/web-search.js";
import type { SearchProviderCredentials } from "../settings-context.js";

/** Build the seed search query from a topic string. */
export function buildSearchQuery(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").substring(0, 300);
}

/** Build engine availability status (✅/❌ per engine, filtered by allowlist). */
export function buildEngineStatus(cred?: SearchProviderCredentials, enabledEngines?: string[]): string {
  return ALL_ENGINES.map((name) => {
    const meta = ENGINE_META[name];
    const allowed = !enabledEngines || enabledEngines.length === 0 || enabledEngines.includes(name);
    if (!allowed) return `  ❌ ${name} (not enabled)`;
    const available = meta.free || (meta.credKey ? cred?.get(name, meta.credKey) != null : false);
    const keyNote = !meta.free && meta.envKey ? ` (needs ${meta.envKey})` : "";
    return `  ${available ? "✅" : "❌"} ${name}${keyNote}`;
  }).join("\n");
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
export interface PlanPromptContext {
  topic: string;
  engines: SearchEngine[];
  profileName: string;
  resolvedBreadth: number;
  resolvedDepth: number;
  resolvedConcurrency: number;
  presets: Record<string, { breadth: number; depth: number; concurrency: number }>;
  searchResults: WebSearchResult[];
  scrapedContent: ScrapedPage[];
}

export function buildPlanPrompt(ctx: PlanPromptContext): string {
  const {
    topic,
    engines,
    profileName,
    resolvedBreadth,
    resolvedDepth,
    resolvedConcurrency,
    presets,
    searchResults,
    scrapedContent,
  } = ctx;
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

/** Build introspection prompt: ask LLM to propose topics from internal knowledge (ADR-0017). */
export function buildIntrospectionPrompt(topic: string): string {
  return `## LLM Knowledge Topics

Propose top-level topics for "${topic}" from your internal knowledge. For each topic, include:
- **Topic name** (short, descriptive)
- **Confidence** (low/medium/high)
- **Importance** (critical/important/supplementary)
- **Key claim** (1 sentence)
- **Uncertainty** (what we don't know)

Respond with structured markdown — one numbered topic per section. Do NOT search the web yet.`;
}

/** Build merge prompt: combine LLM topics with web search results (ADR-0017). */
export function buildMergePrompt(
  topic: string,
  llmTopics: string,
  searchResults: import("../search/web-search.js").WebSearchResult[],
): string {
  let prompt = `## Merge & Plan

Topic: ${topic}\n\n### LLM Knowledge Topics\n${llmTopics}\n\n### Web Search Results\n`;
  for (const r of searchResults) {
    prompt += `- [${r.title}](${r.url}): ${r.snippet}\n`;
  }
  prompt += `\n### Instructions\n\n1. Merge topics from both sources\n2. Tag each topic with source: "web", "internal", or "both"\n3. Rate importance and question validity\n4. Flag contradictions between internal knowledge and web sources\n5. Flag debatable facts that need validation\n6. Produce final Research Plan JSON with questionMetadata`;
  return prompt;
}
