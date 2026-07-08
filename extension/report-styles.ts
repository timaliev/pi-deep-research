import type { ResearchPlan } from "./prefilter.js";
import type { Finding } from "./state-machine.js";
import type { WebSearchResult } from "./search/web-search.js";
import type { ScrapedPage } from "./scraper.js";

export interface ReportStyle {
  buildExtractionPrompt(
    allResults: Array<{ question: string; results: WebSearchResult[] }>,
    scraped: ScrapedPage[],
    depth: number,
    totalDepth: number,
  ): string;
  buildQuestioningPrompt(plan: ResearchPlan, currentDepth: number, totalDepth: number): string;
  buildDraftingPrompt(plan: ResearchPlan, findings: Finding[]): string;
}

/** Format search results and scraped content as markdown — shared by both styles. */
function formatSearchResults(
  allResults: Array<{ question: string; results: WebSearchResult[] }>,
  scraped: ScrapedPage[],
): string {
  let section = `### Search Results\n\n`;
  for (const { question, results } of allResults) {
    section += `**Query:** ${question}\n`;
    for (const r of results) section += `- [${r.title}](${r.url}): ${r.snippet}\n`;
    section += `\n`;
  }
  if (scraped.length > 0) {
    section += `### Scraped Content\n\n`;
    for (const page of scraped) {
      const excerpt = page.content.length > 1000 ? page.content.substring(0, 1000) + "..." : page.content;
      section += `**Source: ${page.title}** (${page.url})\n\n${excerpt}\n\n---\n`;
    }
  }
  return section;
}

class NarrativeStyle implements ReportStyle {
  buildExtractionPrompt(
    allResults: Array<{ question: string; results: WebSearchResult[] }>,
    scraped: ScrapedPage[],
    depth: number,
    totalDepth: number,
  ): string {
    let prompt = `## Research Extraction — Depth ${depth}/${totalDepth}\n\n`;
    prompt += `Extract key findings from the following search results. For each finding, include:\n`;
    prompt += `- The insight (1-2 sentences)\n`;
    prompt += `- Source URL\n`;
    prompt += `- A relevant quote/citation from the source\n\n`;
    prompt += formatSearchResults(allResults, scraped);
    prompt += `\nProduce findings as a numbered list. Each finding must cite its source URL in parentheses.`;
    return prompt;
  }

  buildQuestioningPrompt(plan: ResearchPlan, currentDepth: number, totalDepth: number): string {
    return `## Research Deepening — Depth ${currentDepth}/${totalDepth}\n\nBased on the findings so far, generate 2-3 follow-up questions to deepen the research.\nThese questions should explore aspects not yet fully covered.\n\n**Original research goal:** ${plan.goal}\n\nProduce questions as a numbered list. Each question should be specific and researchable via web search.\n`;
  }

  buildDraftingPrompt(plan: ResearchPlan, findings: Finding[]): string {
    let prompt = `## Final Report\n\nWrite a structured markdown research report based on the following plan and findings. Write the report as your response text directly — do NOT call any tools. Call run_research only after you have written the complete report.\n\n**Topic:** ${plan.topic}\n**Goal:** ${plan.goal}\n\n### Structure\n\n1. **Introduction** — background and why this matters\n2. **Findings** — organized by theme, with citations\n3. **Analysis** — what the findings mean, patterns, contradictions\n4. **Recommendations** — actionable insights\n5. **Sources** — list of all cited URLs\n\n### Key Findings\n\n`;
    for (const f of findings) prompt += `- ${f.text} [Source: ${f.sourceUrl}]\n`;
    return prompt;
  }
}

class SubtopicStyle implements ReportStyle {
  buildExtractionPrompt(
    allResults: Array<{ question: string; results: WebSearchResult[] }>,
    scraped: ScrapedPage[],
    depth: number,
    totalDepth: number,
  ): string {
    let prompt = `## Research Extraction — Depth ${depth}/${totalDepth}\n\n`;
    prompt += `Extract key findings and group them into emerging themes. For each finding, include:\n`;
    prompt += `- The insight (1-2 sentences)\n`;
    prompt += `- Which theme it belongs to\n`;
    prompt += `- Source URL\n`;
    prompt += `- A relevant quote/citation from the source\n\n`;
    prompt += formatSearchResults(allResults, scraped);
    prompt += `\nGroup findings by theme. Each theme should be a named category. List findings under their themes with source citations.`;
    return prompt;
  }

  buildQuestioningPrompt(plan: ResearchPlan, currentDepth: number, totalDepth: number): string {
    return `## Research Deepening — Depth ${currentDepth}/${totalDepth}\n\nBased on the themes identified so far, generate 2-3 questions that deepen specific thematic aspects. Focus on gaps where a theme has insufficient evidence or conflicting findings.\n\n**Original research goal:** ${plan.goal}\n\nProduce questions as a numbered list. Each question should target a specific theme or knowledge gap.\n`;
  }

  buildDraftingPrompt(plan: ResearchPlan, findings: Finding[]): string {
    let prompt = `## Final Report (Subtopics)\n\nWrite a comprehensive markdown research report. Discover ${plan.researchQuestions.length >= 5 ? "8–10" : "5–7"} thematic sections based on the findings below — each section a dedicated topic with subsections where appropriate.\n\nDo NOT use a rigid 5-section template. Instead, let the content drive the structure: group findings into natural themes, give each its own numbered section with descriptive headings, and include data tables, quotes, and comparisons where the evidence supports them.\n\nWrite the report as your response text directly — do NOT call any tools. Call run_research only after you have written the complete report.\n\n**Topic:** ${plan.topic}\n**Goal:** ${plan.goal}\n\n### Structure Guidance\n\n- Start with an Executive Summary (unnumbered)\n- Numbered sections (1., 2., 3., …) — each a distinct thematic area discovered from the findings\n- Subsections (1.1, 1.2, …) where a theme has multiple facets\n- End with a Recommendations section and a References section\n\n### Key Findings\n\n`;
    for (const f of findings) prompt += `- ${f.text} [Source: ${f.sourceUrl}]\n`;
    return prompt;
  }
}

const styles: Record<string, ReportStyle> = {
  narrative: new NarrativeStyle(),
  subtopics: new SubtopicStyle(),
};

export function createReportStyle(name: string): ReportStyle {
  return styles[name] ?? styles.narrative;
}
